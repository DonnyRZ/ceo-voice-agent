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
    if (result?.length !== dimensions || !result.every(Number.isFinite)) {
      throw new Error('Dimensi embedding dari OpenAI tidak sesuai.');
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
  pool: Pool,
  model: string,
  embed: ReturnType<typeof createEmbedder>,
  logger: FastifyBaseLogger,
) {
  const controller = new AbortController();
  let running: Promise<void> | undefined;
  let budgetSpent = false;

  async function run() {
    const { rows } = await pool.query<Job>('SELECT * FROM claim_work_search_embeddings($1, $2)', [model, 4]);
    for (const job of rows) {
      if (controller.signal.aborted) break;
      try {
        const text = [job.title, job.description].filter(Boolean).join('\n');
        const result = await embed(text, controller.signal);
        await pool.query('SELECT complete_work_search_embedding($1, $2, $3, $4, $5::vector)', [
          job.kind, job.resource_id, job.lease_id, model, JSON.stringify(result),
        ]);
      } catch (error) {
        if (error instanceof BudgetExceeded) budgetSpent = true;
        const delaySeconds = Math.min(3600, 15 * 2 ** Math.min(job.attempts, 8));
        await pool.query('SELECT retry_work_search_embedding($1, $2, $3, $4)', [
          job.kind, job.resource_id, job.lease_id, delaySeconds,
        ]);
        if (!controller.signal.aborted) {
          logger.warn({ budgetSpent }, 'Pembaruan embedding dijadwalkan ulang.');
        }
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
