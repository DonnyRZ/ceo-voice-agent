import { closeSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

const asMicros = 1_000_000;
const ledgerSchema = z.object({ confirmed: z.number().int().nonnegative(), reserved: z.number().int().nonnegative() });
export const activeVoiceMicros = (seconds: number) => Math.ceil(seconds * 50_000 / 60);
export const embeddingMicros = (maxTokens: number) => Math.ceil(maxTokens * 0.13);

export class BudgetExceeded extends Error {
  constructor() {
    super('Batas biaya uji OpenAI tercapai.');
  }
}

export function openBudget(limitUsd: number, path = resolve('.voice-pilot/budget.json')) {
  const limit = Math.floor(limitUsd * asMicros);
  const lockPath = path + '.lock';
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

  function update(change: (ledger: z.infer<typeof ledgerSchema>) => void) {
    // Lock the same ledger across workers and restarts before making any paid request.
    const lock = openSync(lockPath, 'wx', 0o600);
    try {
      let ledger = { confirmed: 0, reserved: 0 };
      try {
        ledger = ledgerSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      change(ledger);
      const temp = path + '.tmp';
      writeFileSync(temp, JSON.stringify(ledger) + '\n', { mode: 0o600 });
      renameSync(temp, path);
    } finally {
      closeSync(lock);
      unlinkSync(lockPath);
    }
  }

  return {
    reserve(minimum: number, holdRemaining = false) {
      let amount = minimum;
      update((ledger) => {
        const available = limit - ledger.confirmed - ledger.reserved;
        if (available < minimum) throw new BudgetExceeded();
        if (holdRemaining) amount = available;
        ledger.reserved += amount;
      });
      let settled = false;
      return (actual: number) => {
        if (settled) return;
        update((ledger) => {
          ledger.reserved -= amount;
          ledger.confirmed += actual;
        });
        settled = true;
      };
    },
  };
}

export type OpenAiBudget = ReturnType<typeof openBudget>;
