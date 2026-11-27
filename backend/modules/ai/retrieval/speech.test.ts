import { describe, expect, it } from 'vitest';
import type { CeoFacts } from './schema.js';
import { spokenFacts } from './speech.js';

const facts: CeoFacts = {
  intent: 'summary', tasks: [], history: [],
  entity: { kind: 'division', name: 'IT', id: 'ea0e00b0-201c-4000-8000-000000000001' },
  period: { from: '2026-11-01', to: '2026-11-30' },
  counts: { total: 10, pending: 2, on_progress: 3, done: 5 },
};

describe('Presentasi fakta rekap suara CEO', () => {
  it('menyebut total beserta cakupannya saat hanya jumlah yang diminta', () => {
    expect(spokenFacts(facts, 'total')).toBe('Menurut divisi IT dari 1 November 2026 sampai 30 November 2026, 10 tugas tercatat.');
  });

  it('mempertahankan kategori yang difilter tanpa menambahkan rincian pada jawaban total', () => {
    const filtered: CeoFacts = { ...facts, counts: { total: 7, pending: 2, on_progress: 0, done: 5 }, statusFilter: ['pending', 'done'] };
    expect(spokenFacts(filtered, 'total')).toContain('7 tugas tercatat dengan status pending atau selesai.');
    expect(spokenFacts(facts, 'breakdown')).toContain('2 pending, 3 sedang dikerjakan, dan 5 selesai.');
  });
});
