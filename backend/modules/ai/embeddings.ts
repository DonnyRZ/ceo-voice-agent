import type { FastifyBaseLogger } from 'fastify';
import OpenAI from 'openai';
import type { Pool } from 'pg';
import { BudgetExceeded, embeddingMicros, type OpenAiBudget } from './budget.js';

const dimensions = 1536;

export function createEmbedder(apiKey: string, model: string, budget: OpenAiBudget) {
  const client = new OpenAI({ apiKey, baseURL: 'https://api.openai.com/v1', maxRetries: 0, timeout: 8_000 });
  return async (input: string, signal?: AbortSignal): Promise<number[]> => {
    signal?.throwIfAborted();
    const maximumTokens = Buffer.byteLength(input, 'utf8') + 8;
    const settle = budget.reserve(embeddingMicros(maximumTokens));
    const response = await client.embeddings.create({ model, input, dimensions }, { signal });
    settle(embeddingMicros(response.usage.total_tokens));
    const result = response.data[0]?.embedding;
    if (result?.length !== dimensions || !result.every(Number.isFinite) || !result.some((value) => value !== 0)) {
      throw new Error('Embedding dari OpenAI tidak valid.');
    }
    return result;
  };
}

type Job = {
  kind: 'task' | 'project';
  resource_id: string;
  title: string;
  description: string;
  lease_id: string;
  attempts: number;
};

export function startEmbeddingWorker(
  pool: Pick<Pool, 'query'>,
  model: string,
  embed: ReturnType<typeof createEmbedder>,
  logger: Pick<FastifyBaseLogger, 'debug' | 'warn'>,
) {
  const controller = new AbortController();
  let running: Promise<void> | undefined;
  let budgetSpent = false;

  async function retry(job: Job, delaySeconds: number) {
    try {
      await pool.query('SELECT retry_work_search_embedding($1, $2, $3, $4)', [
        job.kind, job.resource_id, job.lease_id, delaySeconds,
      ]);
    } catch {
      logger.warn('Lease embedding belum dapat dilepas. Antrean akan mencoba lagi setelah lease kedaluwarsa.');
    }
  }

  async function run() {
    const { rows } = await pool.query<Job>('SELECT * FROM claim_work_search_embeddings($1, $2)', [model, 4]);
    for (const job of rows) {
      if (controller.signal.aborted || budgetSpent) {
        await retry(job, 1);
        continue;
      }
      try {
        const text = [job.title, job.description].filter(Boolean).join('\n');
        const result = await embed(text, controller.signal);
        controller.signal.throwIfAborted();
        const { rows: [completion] } = await pool.query<{ completed: boolean }>(
          'SELECT complete_work_search_embedding($1, $2, $3, $4, $5::vector) AS completed', [
            job.kind, job.resource_id, job.lease_id, model, JSON.stringify(result),
          ]);
        if (!completion?.completed) logger.debug('Lease embedding sudah berubah sebelum penyimpanan.');
      } catch (error) {
        if (error instanceof BudgetExceeded) budgetSpent = true;
        const interrupted = controller.signal.aborted;
        const delaySeconds = interrupted || budgetSpent ? 1 : Math.min(3600, 15 * 2 ** Math.min(job.attempts, 8));
        await retry(job, delaySeconds);
        if (!interrupted) logger.warn({ budgetSpent }, 'Pembaruan embedding belum selesai.');
      }
    }
  }

  function tick() {
    if (running || budgetSpent || controller.signal.aborted) return;
    running = run().catch(() => logger.warn('Antrean embedding belum siap.')).finally(() => {
      running = undefined;
    });
  }

  const interval = setInterval(tick, 3_000);
  interval.unref();
  tick();
  return async () => {
    clearInterval(interval);
    controller.abort();
    await running;
  };
}
