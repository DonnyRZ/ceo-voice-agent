import { expect, it, vi } from 'vitest';
import { BudgetExceeded } from './budget.js';
import { startEmbeddingWorker } from './embeddings.js';

const model = 'fixture-model';
const job = (id: string) => ({
  kind: 'task', resource_id: id, title: `Task ${id}`, description: '', lease_id: `lease-${id}`, attempts: 2,
});

function worker(embed: Parameters<typeof startEmbeddingWorker>[2], rows = [job('one'), job('two')]) {
  const query = vi.fn().mockImplementation(async (sql: string) => ({
    rows: sql.includes('claim_work_search_embeddings') ? rows : [],
  }));
  const logger = { debug: vi.fn(), warn: vi.fn() };
  const stop = startEmbeddingWorker({ query }, model, embed, logger);
  const retries = () => query.mock.calls.filter(([sql]) => sql.includes('retry_work_search_embedding'))
    .map(([, parameters]) => parameters);
  return { query, retries, stop };
}

it('releases in-flight and pending jobs when the worker shuts down', async () => {
  const embed = vi.fn<Parameters<typeof startEmbeddingWorker>[2]>(async (_input, signal) => new Promise((resolve) => {
    signal?.addEventListener('abort', () => resolve([1]), { once: true });
  }));
  const queue = worker(embed);
  try {
    await vi.waitFor(() => expect(embed).toHaveBeenCalledOnce());
    await queue.stop();
    expect(queue.retries()).toEqual([['task', 'one', 'lease-one', 1], ['task', 'two', 'lease-two', 1]]);
    expect(queue.query.mock.calls.some(([sql]) => sql.includes('complete_work_search_embedding'))).toBe(false);
  } finally {
    await queue.stop();
  }
});

it('backs off provider errors and promptly releases the batch when the budget is exhausted', async () => {
  const embed = vi.fn<Parameters<typeof startEmbeddingWorker>[2]>()
    .mockRejectedValueOnce(new Error('Temporary provider failure'))
    .mockRejectedValueOnce(new BudgetExceeded());
  const queue = worker(embed, [job('one'), job('two'), job('three')]);
  try {
    await vi.waitFor(() => expect(queue.retries()).toHaveLength(3));
    expect(embed).toHaveBeenCalledTimes(2);
    expect(queue.retries()).toEqual([
      ['task', 'one', 'lease-one', 60], ['task', 'two', 'lease-two', 1], ['task', 'three', 'lease-three', 1],
    ]);
  } finally {
    await queue.stop();
  }
});
