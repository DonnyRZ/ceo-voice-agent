import { randomUUID } from 'node:crypto';
import type { VoiceHistoryEntry } from './history/entry.js';
import { untilAborted } from './lifecycle.js';
import { createVoiceOutputVerifier, type VoiceOutputResult } from './output.js';
import type { LiveSideband, VoiceMetric, VoiceResult } from './types.js';

type Delivery = VoiceOutputResult | { kind: 'rejected' };

export class VoiceCommentary<Facts> {
  readonly output;
  private pending?: { id: string; complete: (ack: { accepted: boolean; endMs?: number }) => void };

  constructor(private readonly options: {
    commentaryTimeoutMs?: number;
    outputTimeoutMs?: number;
    metric(metric: VoiceMetric, turnId: string): void;
    record?(entry: VoiceHistoryEntry<Facts>): void;
  }) {
    this.output = createVoiceOutputVerifier({ timeoutMs: options.outputTimeoutMs });
  }

  observe(id: string, accepted: boolean, endMs?: number) {
    if (this.pending?.id === id) this.pending.complete({ accepted, endMs });
  }

  async deliver(sideband: LiveSideband, turnId: string, inputEndMs: number, result: VoiceResult<Facts>, signal: AbortSignal): Promise<Delivery> {
    const startedAt = performance.now();
    const timeout = AbortSignal.timeout(this.options.commentaryTimeoutMs ?? 2_000);
    const id = randomUUID();
    const acknowledgment = new Promise<{ accepted: boolean; endMs?: number }>((complete) => {
      this.pending = { id, complete };
    });
    const text = [...result.text].length <= 900 ? result.text : 'Rincian hasil ada di layar.';
    const segment = this.output.begin(text, signal, { notBeforeMs: inputEndMs });
    let ack: { accepted: boolean; endMs?: number };
    try {
      sideband.sendCommentary(id, turnId, text);
      this.options.record?.({ type: 'commentary_sent', turnId, commandId: id, text, result });
      ack = await untilAborted(acknowledgment, AbortSignal.any([timeout, signal]));
      this.options.record?.({ type: 'commentary_ack', turnId, commandId: id, ...ack });
      this.acknowledgmentMetric(turnId, startedAt, ack.accepted ? 'accepted' : 'rejected');
    } catch {
      if (!signal.aborted) this.acknowledgmentMetric(turnId, startedAt, timeout.aborted ? 'timeout' : 'rejected');
      return { kind: 'rejected' };
    } finally {
      if (this.pending?.id === id) this.pending = undefined;
    }
    if (!ack.accepted) return { kind: 'rejected' };
    const outcome = await segment.confirm(ack.endMs);
    this.options.metric({
      type: 'latency', stage: 'output_verify', durationMs: performance.now() - startedAt,
      outcome: outcome.kind === 'verified' ? 'verified' : outcome.reason,
      output: outcome.diagnostics, missingAckOffset: ack.endMs === undefined || undefined,
    }, turnId);
    return outcome;
  }

  private acknowledgmentMetric(turnId: string, start: number, outcome: 'accepted' | 'rejected' | 'timeout') {
    this.options.metric({ type: 'latency', stage: 'commentary_ack', durationMs: performance.now() - start, outcome }, turnId);
  }
}
