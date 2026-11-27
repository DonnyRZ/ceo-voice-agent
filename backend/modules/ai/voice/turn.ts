import { randomUUID } from 'node:crypto';
import type { PlaybackStop, VoiceHistoryEntry } from './history/entry.js';
import { untilAborted } from './lifecycle.js';
import { VoicePreparation } from './preparation.js';
import { voiceUnavailableMessage } from './prompt.js';
import type { VoiceTurn } from './transcript.js';
import type { LiveSideband, VoiceEvent, VoiceMetric, VoiceOwner, VoiceResult, VoiceServiceOptions } from './types.js';

interface TurnHandlers<Facts> {
  authorize(): Promise<boolean>;
  sideband(): LiveSideband | undefined;
  emit(event: VoiceEvent<Facts>): void;
  close(): void;
  metric(metric: VoiceMetric, turnId: string): void;
  record?(entry: VoiceHistoryEntry<Facts>): void;
}

export class VoiceTurns<Context, Facts, Prepared> {
  private turn?: { id: string; offsetMs: number; startedAt: number; controller: AbortController };
  private commentary?: { id: string; complete: (accepted: boolean) => void };
  private context?: Context;
  private readonly preparation: VoicePreparation<Context, Prepared>;

  constructor(
    private readonly owner: VoiceOwner,
    private readonly options: VoiceServiceOptions<Context, Facts, Prepared>,
    private readonly handlers: TurnHandlers<Facts>,
  ) {
    this.preparation = new VoicePreparation(owner, options.prepare, options.prepareDelayMs ?? 180);
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
    this.turn = { id, offsetMs, startedAt: performance.now(), controller: new AbortController() };
    this.handlers.emit({ type: 'turn', turnId: id });
    this.handlers.emit({ type: 'playback', turnId: id, allowed: false });
    this.handlers.metric({ type: 'delegation', action: 'started' }, id);
    this.handlers.sideband()?.silenceAcknowledgment?.(id);
    return true;
  }

  observeUserAudio(endMs: number) {
    if (this.turn && endMs > this.turn.offsetMs) this.invalidate('new_speech');
  }

  invalidate(reason: PlaybackStop) {
    if (!this.turn || this.turn.controller.signal.aborted) return;
    this.turn.controller.abort();
    this.handlers.record?.({ type: 'playback_stopped', turnId: this.turn.id, reason });
    this.handlers.emit({ type: 'playback', turnId: this.turn.id, allowed: false });
  }

  observeCommentary(id: string, accepted: boolean) {
    if (this.commentary?.id === id) this.commentary.complete(accepted);
  }

  async resolve(input: VoiceTurn) {
    const turn = this.turn;
    if (!turn || turn.id !== input.id || turn.controller.signal.aborted) return;
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
    const canSpeak = await this.sendCommentary(sideband, input.id, result, signal);
    if (signal.aborted) return;
    if (!canSpeak) {
      this.handlers.close();
      return;
    }
    if (!await this.handlers.authorize() || signal.aborted) return;

    if (context !== undefined && context !== this.context) {
      this.context = context;
      this.preparation.clear();
    }
    this.handlers.emit({ type: 'result', turnId: input.id, result });
    if (!signal.aborted) {
      this.handlers.emit({ type: 'playback', turnId: input.id, allowed: true });
      this.handlers.metric({
        type: 'latency', stage: 'delegation_to_playback_allowed', outcome: 'observed',
        durationMs: performance.now() - turn.startedAt,
      }, input.id);
    }
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
      }), retrievalSignal);
      this.handlers.metric({ type: 'retrieval', outcome: result.kind, durationMs: performance.now() - start }, input.id);
      return result;
    } catch {
      const outcome = signal.aborted ? 'discarded' : timeout.aborted ? 'timeout' : 'error';
      this.handlers.metric({ type: 'retrieval', outcome, durationMs: performance.now() - start }, input.id);
      if (!signal.aborted) return { kind: 'unavailable', text: voiceUnavailableMessage } as const;
    }
  }

  private async sendCommentary(sideband: LiveSideband, delegationId: string, result: VoiceResult<Facts>, signal: AbortSignal) {
    const start = performance.now();
    const timeout = AbortSignal.timeout(this.options.commentaryTimeoutMs ?? 2_000);
    const commentarySignal = AbortSignal.any([timeout, signal]);
    const id = randomUUID();
    const acknowledgment = new Promise<boolean>((complete) => {
      this.commentary = { id, complete };
    });
    const spokenText = [...result.text].length <= 900 ? result.text : 'Rincian hasil ada di layar.';
    try {
      sideband.sendCommentary(id, delegationId, spokenText);
      this.handlers.record?.({ type: 'commentary_sent', turnId: delegationId, text: spokenText, result });
      const accepted = await untilAborted(acknowledgment, commentarySignal);
      if (!signal.aborted) this.handlers.metric({ type: 'latency', stage: 'commentary_ack', outcome: accepted ? 'accepted' : 'rejected', durationMs: performance.now() - start }, delegationId);
      return accepted;
    } catch {
      if (!signal.aborted) this.handlers.metric({ type: 'latency', stage: 'commentary_ack', outcome: timeout.aborted ? 'timeout' : 'rejected', durationMs: performance.now() - start }, delegationId);
      return false;
    } finally {
      if (this.commentary?.id === id) this.commentary = undefined;
    }
  }
}
