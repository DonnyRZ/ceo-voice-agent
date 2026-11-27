import type { FastifyBaseLogger } from 'fastify';
import { activeVoiceMicros, type OpenAiBudget } from '../budget.js';
import type { VoiceAudit } from '../voice-runtime.js';
import { LiveCreateHttpError } from './live-adapter.js';
import type { VoiceAdapter } from './types.js';

export function budgetVoice(
  adapter: VoiceAdapter, budget: OpenAiBudget, maxDurationMs: number, log: FastifyBaseLogger,
  audit?: VoiceAudit,
): VoiceAdapter {
  function report(record: () => void) {
    try {
      record();
    } catch {
      log.warn('Bukti pengujian suara tidak dapat dicatat.');
    }
  }
  const reservations = new Map<string, (micros: number) => void>();
  const settleFinal = (id: string, seconds: number | undefined) => {
    if (seconds === undefined) return;
    try {
      reservations.get(id)?.(activeVoiceMicros(seconds));
    } catch {
      log.warn('Penggunaan OpenAI belum dapat disimpan. Cadangan anggaran tetap ditahan.');
    } finally {
      reservations.delete(id);
    }
  };
  return {
    async createSession(sdp, signal, vocabulary) {
      // Keep the remaining allowance reserved until Live confirms final usage.
      const settle = budget.reserve(activeVoiceMicros(Math.max(15, maxDurationMs / 1000)), true);
      try {
        const started = await adapter.createSession(sdp, signal, vocabulary);
        reservations.set(started.id, settle);
        return started;
      } catch (error) {
        if (error instanceof LiveCreateHttpError) {
          log.warn({ status: error.status }, 'Pembukaan sesi GPT Live ditolak.');
          if (error.status < 500) settle(0);
        }
        throw error;
      }
    },
    async attach(id, handlers, signal) {
      const sideband = await adapter.attach(id, {
        ...handlers,
        onEvent(event) {
          if (event.type === 'closed') settleFinal(id, event.seconds);
          if (audit?.providerEvent) report(() => audit.providerEvent?.(event));
          handlers.onEvent(event);
        },
      }, signal);
      if (!audit?.commentarySent) return sideband;
      return {
        silenceAcknowledgment: sideband.silenceAcknowledgment?.bind(sideband),
        finish: sideband.finish.bind(sideband),
        sendCommentary(eventId, delegationId, text) {
          if (audit.commentarySent) report(() => audit.commentarySent?.(eventId, delegationId, text));
          sideband.sendCommentary(eventId, delegationId, text);
        },
      };
    },
    async closeSession(id, sideband, onEvent) {
      await adapter.closeSession(id, sideband, (event) => {
        if (event.type === 'closed') settleFinal(id, event.seconds);
        onEvent?.(event);
      });
      reservations.delete(id);
    },
  };
}
