import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { inTransaction } from '../../../../db/transaction.js';
import type { VoiceHistoryEntry } from './entry.js';

type HistoryRow<Facts> = {
  session_id: string;
  sequence: number;
  recorded_at: Date;
  payload: VoiceHistoryEntry<Facts>;
};

const flushDelayMs = 200;
const batchLimit = 128;
const queueLimit = 2_048;

async function insertHistory<Facts>(pool: Pool, batch: HistoryRow<Facts>[]) {
  // PostgreSQL JSONB rejects NULs and lone surrogates, which can occur in a transcript delta.
  const data = JSON.stringify(batch, (_key, value: unknown) =>
    typeof value === 'string' ? Buffer.from(value).toString().replaceAll('\0', '') : value);
  await inTransaction(pool, async (db) => {
    await db.query("SET LOCAL statement_timeout = '1000ms'");
    await db.query(`
      INSERT INTO app_private.ceo_voice_test_events (session_id, sequence, recorded_at, kind, payload)
      SELECT entry.session_id, entry.sequence, entry.recorded_at, entry.payload->>'type', entry.payload
      FROM jsonb_to_recordset($1::jsonb) AS entry(
        session_id uuid, sequence integer, recorded_at timestamptz, payload jsonb
      )
      ON CONFLICT DO NOTHING
    `, [data]);
  });
}

export function createVoiceHistory<Facts>(pool: Pool, log: FastifyBaseLogger, model: string) {
  const queue: HistoryRow<Facts>[] = [];
  let timer: NodeJS.Timeout | undefined;
  let writing: Promise<boolean> | undefined;
  let closing = false;
  let retryMs = 1_000;
  let warnedFull = false;

  async function flushBatch() {
    const batch = queue.slice(0, batchLimit);
    try {
      await insertHistory(pool, batch);
      queue.splice(0, batch.length);
      retryMs = 1_000;
      warnedFull = false;
      return true;
    } catch {
      log.warn({ pending: queue.length }, 'Gagal menyimpan riwayat uji suara CEO.');
      return false;
    }
  }

  function schedule(delayMs: number) {
    if (closing || timer || writing || !queue.length) return;
    timer = setTimeout(() => {
      timer = undefined;
      writing = flushBatch();
      void writing.then((saved) => {
        writing = undefined;
        const nextDelay = saved ? flushDelayMs : retryMs;
        if (!saved) retryMs = Math.min(retryMs * 2, 5_000);
        schedule(nextDelay);
      });
    }, delayMs);
    timer.unref();
  }

  return {
    record(sessionId: string, sequence: number, entry: VoiceHistoryEntry<Facts>) {
      if (closing) return;
      if (queue.length >= queueLimit) {
        if (!warnedFull) log.error({ sessionId }, 'Antrean riwayat uji suara penuh. Sebagian event tidak akan tersimpan.');
        warnedFull = true;
        return;
      }
      queue.push({
        session_id: sessionId,
        sequence,
        recorded_at: new Date(),
        payload: entry.type === 'session_attempt' ? { ...entry, model } : entry,
      });
      schedule(flushDelayMs);
    },

    async close() {
      closing = true;
      clearTimeout(timer);
      await writing;
      while (queue.length) {
        if (!await flushBatch()) {
          log.error({ pending: queue.length }, 'Server berhenti dengan riwayat uji suara yang belum tersimpan.');
          break;
        }
      }
    },
  };
}
