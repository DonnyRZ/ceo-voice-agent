import { describe, expect, it, vi } from 'vitest';
import { retrieveCeoAnswer } from './index.js';
import type { CeoInterpretation } from './interpretation.js';
import { now, finance, mobile, web, lookup, interpreter, database } from './retrieval-test-fixture.js';

describe('CEO inline work item correction', () => {
  describe('inline subject correction', () => {
    const old = { ...mobile, kind: 'task', name: 'Validasi alur login', status: 'on_progress' };
    const replacement = { ...web, kind: 'task', name: 'Uji notifikasi', status: 'done' };
    const expanded = { ...old, id: finance.id, name: `Lengkap ${old.name}` };
    const correction = { supersededSubject: old.name, bridge: ', maaf maksud saya tugas' };
    const correctedLookup = (fields: Partial<CeoInterpretation> = {}) => lookup({
      subject: replacement.name, workKind: 'task', correction, ...fields,
    });

    it.each([', maaf maksud saya tugas', 'maaf maksud saya tugas'])(
      'retains the replacement task given the verbatim bridge %s', async (bridge) => {
        const { db, calls } = database([old, replacement]);
        const result = await retrieveCeoAnswer({ db, now,
          transcript: `Apa status tugas ${old.name}${bridge.startsWith(',') ? '' : ' '}${bridge} ${replacement.name}`,
          interpret: interpreter(correctedLookup({ correction: { ...correction, bridge } })),
        });
        expect(result).toMatchObject({ kind: 'facts', facts: { entity: { id: replacement.id }, status: 'done' } });
        expect(calls.find(({ sql }) => sql.includes('WITH selected AS MATERIALIZED'))?.parameters[2]).toBe(replacement.id);
      },
    );

    it('keeps comparisons and an independent third title from becoming a single-item answer', async () => {
      const third = { ...old, id: finance.id, name: 'Audit akun' };
      const { db, calls } = database([old, replacement, third]);
      const compare = `Bandingkan status tugas ${old.name} dengan tugas ${replacement.name}.`;
      const comparison = await retrieveCeoAnswer({ db, now, transcript: compare,
        interpret: interpreter(correctedLookup({ correction: null })) });
      expect(comparison.kind).toBe('clarify');
      expect(comparison.context.choices?.map(({ id }) => id)).toEqual([replacement.id, old.id]);
      const thirdMention = await retrieveCeoAnswer({ db, now,
        transcript: `Apa status tugas ${old.name}, maaf maksud saya tugas ${replacement.name} dan tugas ${third.name}?`,
        interpret: interpreter(correctedLookup()),
      });
      expect(thirdMention.kind).toBe('clarify');
      expect(thirdMention.context.choices?.map(({ id }) => id)).toEqual([third.id, replacement.id]);
      expect(calls.some(({ sql }) => sql.includes('WITH selected AS MATERIALIZED'))).toBe(false);
    });

    it('answers a newly named work item when the putative superseded title appears only in history', async () => {
      const prior = { ...old, name: 'Uji notifikasi' };
      const current = { ...replacement, name: 'Rekonsiliasi transaksi', status: 'on_progress' };
      const { db } = database([prior, current]);
      const first = await retrieveCeoAnswer({ db, now, transcript: 'Apa status tugas uji notifikasi?',
        interpret: interpreter(lookup({ subject: prior.name, workKind: 'task' })) });
      expect(first).toMatchObject({ kind: 'facts', facts: { entity: { id: prior.id } } });
      const answer = await retrieveCeoAnswer({ db, now, context: first.context,
        history: [{ role: 'user', text: 'Apa status tugas uji notifikasi?' }],
        transcript: 'Maaf, pertanyaannya berubah. Apa status tugas rekonsiliasi transaksi',
        interpret: interpreter(correctedLookup({ subject: current.name, correction: {
          supersededSubject: prior.name, bridge: 'Maaf, pertanyaannya berubah. Apa status tugas',
        } })),
      });
      expect(answer).toMatchObject({ kind: 'facts', facts: { entity: { id: current.id }, status: 'on_progress' } });
    });

    it.each([
      [`Apa status tugas ${old.name}, lalu tugas ${replacement.name}?`, correction, old],
      [`Bandingkan status tugas ${old.name} dengan tugas ${replacement.name}.`, { ...correction, bridge: 'dengan tugas' }, old],
      [`Apa status tugas ${replacement.name}, maaf maksud saya tugas ${old.name}?`, correction, old],
      [`Apa status tugas “${expanded.name}”, maaf maksud saya tugas ${replacement.name}?`, correction, expanded],
    ] as const)('keeps exact rivals in %s when a replacement is unproven', async (transcript, evidence, rival) => {
      const { db, calls } = database([rival, replacement]);
      const result = await retrieveCeoAnswer({ db, now, transcript,
        interpret: interpreter(correctedLookup({ correction: evidence })) });
      expect(result.kind).toBe('clarify');
      expect(new Set(result.context.choices?.map(({ id }) => id))).toEqual(new Set([replacement.id, rival.id]));
      expect(calls.some(({ sql }) => sql.includes('WITH selected AS MATERIALIZED'))).toBe(false);
    });

    it('does not revive a superseded task through an approximate replacement search', async () => {
      const { db, calls } = database([old]);
      const embed = vi.fn();
      const result = await retrieveCeoAnswer({ db, now, embed,
        transcript: `Apa status tugas ${old.name}, maaf maksud saya tugas ${replacement.name}?`,
        interpret: interpreter(correctedLookup()),
      });
      expect(result.kind).toBe('clarify');
      expect(result.context.choices).toBeUndefined();
      expect(calls.some(({ sql }) => sql.includes('ceo_search_work') || sql.includes('WITH selected AS MATERIALIZED'))).toBe(false);
      expect(embed).not.toHaveBeenCalled();
    });
  });
});
