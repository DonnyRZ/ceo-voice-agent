import { randomUUID } from 'node:crypto';
import type { VoiceHistoryEntry } from './history/entry.js';
import { createVoiceInput } from './input.js';
import { untilAborted, VoiceServiceError, voiceTerminalState } from './lifecycle.js';
import { VoiceTurns } from './turn.js';
import type { LiveEvent, LiveSideband, VoiceCloseReason, VoiceEvent, VoiceMetric, VoiceOwner, VoiceServiceOptions, VoiceState } from './types.js';

type Listener<Facts> = (event: VoiceEvent<Facts>) => void;

export class VoiceSession<Context, Facts, Prepared> {
  readonly id = randomUUID();
  private readonly startedAt = performance.now();
  private readonly input: ReturnType<typeof createVoiceInput<Context, Facts, Prepared>>;
  private readonly lifetime = new AbortController();
  private readonly listeners = new Set<Listener<Facts>>();
  private readonly turns: VoiceTurns<Context, Facts, Prepared>;
  private state: VoiceState = 'connecting';
  private reason?: VoiceCloseReason;
  private providerId?: string;
  private providerClosed = false;
  private providerClosing?: Promise<void>;
  private sentFinalUsage = false;
  private sideband?: LiveSideband;
  private duration?: ReturnType<typeof setTimeout>;
  private access?: ReturnType<typeof setTimeout>;
  private historySequence = 0;
  private pendingPlaybackSamples = 0;

  constructor(
    readonly owner: VoiceOwner,
    private readonly options: VoiceServiceOptions<Context, Facts, Prepared>,
    private readonly onEnd: (session: VoiceSession<Context, Facts, Prepared>, cleanup: Promise<void>) => void,
  ) {
    const record = options.onHistory && ((entry: VoiceHistoryEntry<Facts>) => this.record(entry));
    const metric = (event: VoiceMetric, turnId: string) => this.metric(event, turnId);
    this.turns = new VoiceTurns(owner, options, {
      authorize: () => this.authorize(),
      sideband: () => this.sideband,
      emit: (event) => this.emit(event),
      close: () => { void this.end('unavailable'); },
      metric, record,
    });
    this.input = createVoiceInput(this.turns, {
      settleMs: options.settleMs, prepareCandidates: !!options.prepare, metric, record,
    });
  }

  async start(sdp: string) {
    this.record({ type: 'session_attempt', userId: this.owner.userId });
    this.duration = setTimeout(() => { void this.end('timeout'); }, this.options.maxDurationMs ?? 120_000);
    this.duration.unref();
    const timeout = AbortSignal.timeout(this.options.startupTimeoutMs ?? 10_000);
    const signal = AbortSignal.any([timeout, this.lifetime.signal]);
    try {
      const canCreate = await this.authorize(signal);
      signal.throwIfAborted();
      if (!canCreate) throw new VoiceServiceError('unauthorized');
      const creation = this.options.adapter.createSession(sdp, signal).then((connection) => {
        this.providerId = connection.id;
        if (this.reason) void this.closeProvider();
        return connection;
      });
      const connection = await untilAborted(creation, signal);
      this.sideband = await untilAborted(this.options.adapter.attach(connection.id, {
        onEvent: (event) => this.onLiveEvent(event),
        onDisconnect: () => { void this.end('unavailable'); },
      }, signal), signal);
      signal.throwIfAborted();
      const canAttach = await this.authorize(signal);
      signal.throwIfAborted();
      if (!canAttach) throw new VoiceServiceError('unauthorized');
      if (this.state === 'connecting') this.changeState('standby');
      this.scheduleAccessCheck();
      this.metric({ type: 'session', action: 'started', durationMs: performance.now() - this.startedAt });
      return { id: this.id, sdp: connection.sdp };
    } catch (error) {
      if (!this.reason) void this.end(timeout.aborted ? 'timeout' : 'unavailable');
      this.metric({ type: 'session', action: 'failed', reason: this.reason, durationMs: performance.now() - this.startedAt });
      if (error instanceof VoiceServiceError) throw error;
      throw new VoiceServiceError(this.reason === 'revoked' ? 'unauthorized' : 'provider_unavailable');
    }
  }

  subscribe(listener: Listener<Facts>) {
    listener({ type: 'state', state: this.state, reason: this.reason });
    if (!this.reason) this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  recordBrowserPlayback(elapsedMs: number) {
    // The browser reports at session scope. Allow one sample per playback release.
    if (!this.options.onHistory || this.pendingPlaybackSamples === 0) return;
    this.pendingPlaybackSamples -= 1;
    this.record({ type: 'browser_playback', elapsedMs });
  }

  end(reason: VoiceCloseReason) {
    if (this.reason) return this.providerClosing ?? Promise.resolve();
    this.reason = reason;
    this.lifetime.abort();
    this.input.close();
    clearTimeout(this.duration);
    clearTimeout(this.access);
    this.turns.invalidate(reason);
    this.turns.cancelPreparation();
    this.emit({ type: 'state', state: voiceTerminalState(reason), reason });
    this.listeners.clear();
    const cleanup = this.closeProvider();
    this.onEnd(this, cleanup);
    this.metric({ type: 'session', action: 'closed', reason, durationMs: performance.now() - this.startedAt });
    return cleanup;
  }

  private closeProvider() {
    if (this.providerId && !this.providerClosed && !this.providerClosing) {
      this.providerClosing = this.options.adapter.closeSession(this.providerId, this.sideband,
        (event) => this.onLiveEvent(event)).catch(() => undefined);
    }
    return this.providerClosing ?? Promise.resolve();
  }

  private async authorize(deadline = this.lifetime.signal) {
    if (this.reason) return false;
    if (!this.options.authorize) return true;
    const timeout = AbortSignal.timeout(this.options.accessTimeoutMs ?? 2_000);
    const signal = AbortSignal.any([deadline, timeout]);
    const permitted = await untilAborted(Promise.resolve().then(() => this.options.authorize!(this.owner)), signal)
      .catch(() => false);
    if (this.reason || deadline.aborted) return false;
    if (!permitted) void this.end('revoked');
    return permitted;
  }

  private scheduleAccessCheck() {
    this.access = setTimeout(() => {
      void this.authorize().then((allowed) => { if (allowed) this.scheduleAccessCheck(); });
    }, this.options.accessCheckMs ?? 5_000);
    this.access.unref();
  }

  private onLiveEvent(event: LiveEvent) {
    if (event.type === 'usage' || event.type === 'closed') {
      const final = event.type === 'closed';
      if (event.seconds !== undefined && !this.sentFinalUsage) {
        this.record({ type: 'usage', seconds: event.seconds, final });
        this.options.onUsage?.({ id: this.id, providerId: this.providerId, userId: this.owner.userId, seconds: event.seconds, final });
        this.sentFinalUsage = final;
      }
      if (event.type === 'closed') {
        this.providerClosed = true;
        void this.end(event.reason ?? 'ended');
      }
      return;
    }
    if (this.reason) return;

    switch (event.type) {
      case 'active':
      case 'standby':
        if (event.type === 'standby') {
          this.turns.invalidate('standby');
          this.turns.cancelPreparation();
        }
        this.changeState(event.type);
        break;
      case 'transcript':
        this.input.append(event.fragment);
        break;
      case 'provider_error':
        this.record(event);
        break;
      case 'delegation':
        this.input.delegate(event.id, event.offsetMs);
        break;
      case 'commentary_accepted':
      case 'commentary_rejected':
        this.turns.observeCommentary(event.eventId, event.type === 'commentary_accepted');
        break;
    }
  }

  private changeState(state: 'active' | 'standby') {
    if (this.state === state) return;
    this.state = state;
    this.emit({ type: 'state', state });
    this.metric({ type: 'state', state });
  }

  private metric(metric: VoiceMetric, turnId?: string) {
    this.options.onMetric?.(metric);
    this.record({ type: 'metric', turnId, metric });
  }

  private record(entry: VoiceHistoryEntry<Facts>) {
    this.options.onHistory?.(this.id, ++this.historySequence, entry);
  }

  private emit(event: VoiceEvent<Facts>) {
    if (event.type === 'playback' && event.allowed && this.options.onHistory) {
      this.pendingPlaybackSamples += 1;
      this.record(event);
    }
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        this.listeners.delete(listener);
      }
    }
  }
}
