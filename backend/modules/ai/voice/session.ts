import { randomUUID } from 'node:crypto';
import type { VoiceHistoryEntry } from './history/entry.js';
import { createVoiceInput } from './input.js';
import { untilAborted, VoiceServiceError, voiceTerminalState } from './lifecycle.js';
import { VoiceTurns } from './turn.js';
import { createSessionEvents } from './session-events.js';
import type { LiveEvent, LiveSideband, VoiceCloseReason, VoiceEvent, VoiceMetric, VoiceOwner, VoiceServiceOptions, VoiceState, VoiceTurnKey } from './types.js';

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
  private opening?: Promise<unknown>;
  private providerClosing?: Promise<void>;
  private sideband?: LiveSideband;
  private duration?: ReturnType<typeof setTimeout>;
  private access?: ReturnType<typeof setTimeout>;
  private historySequence = 0;
  private playbackSample?: VoiceTurnKey;
  private readonly onLiveEvent: (event: LiveEvent) => void;

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
    this.onLiveEvent = createSessionEvents(this.turns, this.input, {
      closed: () => !!this.reason, state: () => this.state,
      record: (entry) => this.record(entry), changeState: (state) => this.changeState(state),
      usage: (seconds, final) => this.options.onUsage?.({
        id: this.id, providerId: this.providerId, userId: this.owner.userId, seconds, final,
      }),
      providerClosed: (reason) => { this.providerClosed = true; void this.end(reason); },
    });
  }

  async start(sdp: string) {
    this.record({ type: 'session_attempt', userId: this.owner.userId });
    this.duration = setTimeout(() => { void this.end('timeout'); }, this.options.maxDurationMs ?? 120_000).unref();
    const timeout = AbortSignal.timeout(this.options.startupTimeoutMs ?? 10_000);
    const signal = AbortSignal.any([timeout, this.lifetime.signal]);
    try {
      const canCreate = await this.authorize(signal);
      signal.throwIfAborted();
      if (!canCreate) throw new VoiceServiceError('unauthorized');
      // Track the adapter work separately from the caller's abortable wait.
      const creation = Promise.resolve().then(async () => {
        const vocabulary = await this.options.loadVocabulary?.(this.owner, signal);
        signal.throwIfAborted();
        return vocabulary ? this.options.adapter.createSession(sdp, signal, vocabulary) : this.options.adapter.createSession(sdp, signal);
      }).then((connection) => {
        this.providerId = connection.id;
        return connection;
      });
      this.opening = creation;
      const connection = await untilAborted(creation, signal);
      signal.throwIfAborted();
      const attaching = Promise.resolve().then(() => {
        signal.throwIfAborted();
        return this.options.adapter.attach(connection.id, {
          onEvent: (event) => this.onLiveEvent(event),
          onDisconnect: () => { void this.end('unavailable'); },
        }, signal);
      }).then((sideband) => {
        this.sideband = sideband;
      });
      this.opening = attaching;
      await untilAborted(attaching, signal);
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

  recordBrowserPlayback(elapsedMs: number, turn?: VoiceTurnKey) {
    if (!turn || this.playbackSample?.turnId !== turn.turnId || this.playbackSample.generation !== turn.generation) return false;
    this.playbackSample = undefined;
    this.record({ type: 'browser_playback', elapsedMs, ...turn });
    return true;
  }

  async takeAudio(turn: VoiceTurnKey) {
    if (!await this.authorize() || this.reason || this.state !== 'active') throw new VoiceServiceError('session_not_found');
    return this.turns.takeAudio(turn);
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
    const cleanup = this.providerClosing ??= this.finishProvider();
    this.onEnd(this, cleanup);
    this.metric({ type: 'session', action: 'closed', reason, durationMs: performance.now() - this.startedAt });
    return cleanup;
  }

  private async finishProvider() {
    // Late create/attach cleanup holds the per-user session limit until the adapter settles.
    await this.opening?.catch(() => undefined);
    if (!this.providerId || this.providerClosed) return;
    try {
      await this.options.adapter.closeSession(this.providerId, this.sideband, (event) => this.onLiveEvent(event));
    } catch {
      // A provider whose connection is already gone may reject close.
    }
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
    }, this.options.accessCheckMs ?? 5_000).unref();
  }

  private changeState(state: 'active' | 'standby') {
    if (this.state === state) return;
    this.state = state;
    this.emit({ type: 'state', state });
    this.metric({ type: 'state', state });
  }

  private metric(metric: VoiceMetric, turnId?: string) {
    this.options.onMetric?.(metric, turnId);
    this.record({ type: 'metric', turnId, metric });
  }

  private record(entry: VoiceHistoryEntry<Facts>) {
    this.options.onHistory?.(this.id, ++this.historySequence, entry);
  }

  private emit(event: VoiceEvent<Facts>) {
    if (event.type === 'turn' || event.type === 'state' && event.state !== 'active') this.playbackSample = undefined;
    if (event.type === 'playback') {
      this.playbackSample = event.allowed ? { turnId: event.turnId, generation: event.generation } : undefined;
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
