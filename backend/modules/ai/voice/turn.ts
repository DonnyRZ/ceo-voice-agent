import { VoiceCommentary } from './commentary.js';
import type { PlaybackStop, VoiceHistoryEntry } from './history/entry.js';
import { untilAborted } from './lifecycle.js';
import { VoicePreparation } from './preparation.js';
import { voiceUnavailableMessage } from './prompt.js';
import type { VoiceTurn } from './transcript.js';
import type { LiveSideband, VoiceEvent, VoiceMetric, VoiceOwner, VoiceResult, VoiceServiceOptions, VoiceTurnKey } from './types.js';
import { verifiedVoiceWav } from './wav.js';

interface TurnHandlers<Facts> {
  authorize(): Promise<boolean>;
  sideband(): LiveSideband | undefined;
  emit(event: VoiceEvent<Facts>): void;
  close(): void;
  metric(metric: VoiceMetric, turnId: string): void;
  record?(entry: VoiceHistoryEntry<Facts>): void;
}

export class VoiceTurns<Context, Facts, Prepared> {
  private turn?: VoiceTurnKey & { offsetMs: number; startedAt: number; controller: AbortController };
  private generation = 0;
  private clip?: VoiceTurnKey & { audio: Buffer; expiresAt: number };
  private expiry?: ReturnType<typeof setTimeout>;
  readonly commentary: VoiceCommentary<Facts>;
  private context?: Context;
  private readonly preparation: VoicePreparation<Context, Prepared>;

  constructor(
    private readonly owner: VoiceOwner,
    private readonly options: VoiceServiceOptions<Context, Facts, Prepared>,
    private readonly handlers: TurnHandlers<Facts>,
  ) {
    this.preparation = new VoicePreparation(owner, options.prepare, options.prepareDelayMs ?? 180);
    this.commentary = new VoiceCommentary({
      commentaryTimeoutMs: options.commentaryTimeoutMs,
      outputTimeoutMs: options.outputTimeoutMs,
      metric: handlers.metric,
      record: handlers.record,
    });
  }

  prepare(text: string) {
    this.preparation.queue(text, this.context);
  }

  cancelPreparation() {
    this.preparation.clear();
  }

  begin(id: string, offsetMs: number) {
    if (this.turn && offsetMs <= this.turn.offsetMs) return false;
    this.invalidate('new_delegation');
    const generation = ++this.generation;
    this.turn = { turnId: id, generation, offsetMs, startedAt: performance.now(), controller: new AbortController() };
    this.handlers.emit({ type: 'turn', turnId: id, generation });
    this.handlers.metric({ type: 'delegation', action: 'started' }, id);
    this.handlers.sideband()?.silenceAcknowledgment?.(id);
    return true;
  }

  observeUserAudio(endMs: number) {
    if (this.turn && endMs > this.turn.offsetMs) this.invalidate('new_speech');
  }

  unverifiedInput(id: string) {
    if (this.turn?.turnId !== id || this.turn.controller.signal.aborted) return;
    const { generation } = this.turn;
    this.invalidate('missing_input');
    this.handlers.emit({ type: 'playback', turnId: id, generation, allowed: false, reason: 'unverified' });
  }

  invalidate(reason: PlaybackStop) {
    this.clearClip();
    this.commentary.output.reset();
    if (!this.turn || this.turn.controller.signal.aborted) return;
    this.turn.controller.abort();
    const { turnId, generation } = this.turn;
    this.handlers.record?.({ type: 'playback_stopped', turnId, generation, reason });
    this.handlers.emit({ type: 'playback', turnId, generation, allowed: false });
  }

  takeAudio({ turnId, generation }: VoiceTurnKey) {
    const clip = this.clip;
    if (!clip || clip.turnId !== turnId || clip.generation !== generation || clip.expiresAt <= performance.now()) return;
    this.clearClip();
    return clip.audio;
  }

  private clearClip() {
    clearTimeout(this.expiry);
    this.clip = undefined;
  }

  async resolve(input: VoiceTurn) {
    const turn = this.turn;
    if (!turn || turn.turnId !== input.id || turn.controller.signal.aborted) return;
    const { turnId, generation } = turn;
    const { signal } = turn.controller;
    if (!await this.handlers.authorize() || signal.aborted) return;

    const answer = await this.retrieve(input, signal);
    if (!answer || signal.aborted || !await this.handlers.authorize() || signal.aborted) return;
    const sideband = this.handlers.sideband();
    if (!sideband) {
      this.handlers.close();
      return;
    }

    const { kind, text, facts, context } = answer;
    const result: VoiceResult<Facts> = { kind, text, facts };
    const delivery = await this.commentary.deliver(sideband, turnId, Math.max(turn.offsetMs, input.userEndMs), result, signal);
    if (signal.aborted) return;
    if (delivery.kind === 'rejected') {
      this.handlers.close();
      return;
    }
    if (!await this.handlers.authorize() || signal.aborted) return;

    const audio = delivery.kind === 'verified' ? verifiedVoiceWav(delivery.pcm) : undefined;
    const nextContext = context === undefined || result.kind === 'facts' || audio
      ? context : this.options.contextWithoutAudio?.(context);
    if (nextContext !== undefined && nextContext !== this.context) {
      this.context = nextContext;
      this.preparation.clear();
    }
    this.handlers.emit({ type: 'result', turnId, generation, result });
    if (signal.aborted) return;
    if (!audio) {
      this.handlers.emit({ type: 'playback', turnId, generation, allowed: false, reason: 'unverified' });
      return;
    }
    this.clip = { turnId, generation, audio, expiresAt: performance.now() + 5_000 };
    this.expiry = setTimeout(() => this.clearClip(), 5_000);
    this.expiry.unref();
    this.handlers.emit({ type: 'playback', turnId, generation, allowed: true });
    this.handlers.metric({
      type: 'latency', stage: 'delegation_to_playback_allowed', outcome: 'observed',
      durationMs: performance.now() - turn.startedAt,
    }, turnId);
  }

  private async retrieve(input: VoiceTurn, signal: AbortSignal): Promise<(VoiceResult<Facts> & { context?: Context }) | undefined> {
    const start = performance.now();
    const timeout = AbortSignal.timeout(this.options.retrievalTimeoutMs ?? 5_000);
    const retrievalSignal = AbortSignal.any([timeout, signal]);
    try {
      const result = await untilAborted(this.options.retrieve({
        ...this.owner,
        text: input.text,
        history: input.history,
        context: this.context,
        prepared: this.preparation.take(input.text, this.context),
        signal: retrievalSignal,
        observePhase: (metric) => this.handlers.metric(metric, input.id),
      }), retrievalSignal);
      this.handlers.metric({ type: 'retrieval', outcome: result.kind, durationMs: performance.now() - start }, input.id);
      return result;
    } catch (error) {
      const timedOut = timeout.aborted || (error instanceof Error && error.name === 'TimeoutError');
      const outcome = signal.aborted ? 'discarded' : timedOut ? 'timeout' : 'error';
      this.handlers.metric({ type: 'retrieval', outcome, durationMs: performance.now() - start }, input.id);
      if (!signal.aborted) return { kind: 'unavailable', text: voiceUnavailableMessage } as const;
    }
  }
}
