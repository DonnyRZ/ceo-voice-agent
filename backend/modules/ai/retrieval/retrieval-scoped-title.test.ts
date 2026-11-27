import { describe, expect, it, vi } from 'vitest';
import { retrieveCeoAnswer } from './index.js';
import type { CeoInterpretation } from './interpretation.js';
import { now, itDivision, finance, mobile, web, lookup, interpreter, database } from './retrieval-test-fixture.js';

describe('CEO title grounding and spoken division scope', () => {
  it('answers a scoped title exactly when structured interpretation excludes adjacent request grammar', async () => {
    const itProject = { ...mobile, name: 'Sinkronisasi Arsip' };
    const financeProject = { ...web, name: itProject.name, divisionId: finance.id, divisionName: finance.name };
    const { db, calls } = database([itProject, financeProject]);
    const transcript = 'Sebelum lanjut, apakah ada informasi status proyek sinkronisasi arsip khusus di divisi Finance?';
    const interpret = interpreter(lookup({ subject: financeProject.name, divisionId: finance.id }));
    const exact = await retrieveCeoAnswer({ db, now, transcript,
      interpret });
    expect(interpret).toHaveBeenCalledWith(expect.objectContaining({ currentTitleHints: [financeProject.name] }));
    expect(exact).toMatchObject({ kind: 'facts', facts: { entity: { id: financeProject.id } } });

    const correctedScope = await retrieveCeoAnswer({ db, now, transcript,
      interpret: interpreter(lookup({ subject: `proyek ${financeProject.name} khusus`, divisionId: finance.id,
        divisionExcerpt: 'khusus di divisi Finance' })) });
    expect(correctedScope).toMatchObject({ kind: 'facts', facts: { entity: { id: financeProject.id } } });

    calls.length = 0;
    for (const divisionExcerpt of [undefined, 'di divisi Finance', 'khusus di divisi IT', `${financeProject.name} khusus di divisi Finance`]) {
      const extended = await retrieveCeoAnswer({ db, now, transcript,
        interpret: interpreter(lookup({ subject: `${financeProject.name} khusus`, divisionId: finance.id, divisionExcerpt })) });
      expect(extended.kind).toBe('clarify');
      expect(extended.context.pendingRequest?.subject).toBe('sinkronisasi arsip khusus');
      expect(extended.context.choices?.map(({ id }) => id)).toEqual([financeProject.id]);
    }
    expect(calls.some(({ sql }) => sql.includes('work.status'))).toBe(false);
  });

  it('keeps an exact longer title in contention after trimming the proposed subject at the spoken division scope', async () => {
    const short = { ...mobile, name: 'Sinkronisasi Arsip', divisionId: finance.id, divisionName: finance.name };
    const longer = { ...short, id: web.id, name: 'Sinkronisasi Arsip Khusus' };
    const { db, calls } = database([short, longer]);
    const interpret = interpreter(lookup({ subject: `proyek ${longer.name}`, divisionId: finance.id,
      divisionExcerpt: 'Khusus di divisi Finance' }));
    const answer = await retrieveCeoAnswer({ db, now, interpret,
      transcript: 'Apa status proyek Sinkronisasi Arsip Khusus di divisi Finance?' });
    expect(interpret).toHaveBeenCalledWith(expect.objectContaining({ currentTitleHints: [longer.name, short.name] }));
    expect(answer.kind).toBe('clarify');
    expect(answer.context.choices?.map(({ id }) => id)).toEqual([short.id, longer.id]);
    expect(calls.some(({ sql }) => sql.includes('work.status'))).toBe(false);
  });

  describe('scoped title recheck', () => {
    const project = { ...mobile, name: 'Sinkronisasi Arsip', divisionId: finance.id, divisionName: finance.name };
    const transcript = 'Sebelum lanjut, apakah ada informasi status proyek sinkronisasi arsip khusus di divisi finance?';
    const provisional = lookup({ subject: 'proyek sinkronisasi arsip khusus', divisionId: finance.id,
      divisionExcerpt: 'divisi finance' });
    const revised = { ...provisional, subject: project.name, divisionExcerpt: 'khusus di divisi finance' };

    it('asks once for literal scope proof and rechecks the original transcript before returning facts', async () => {
      const { db } = database([project]);
      const interpret = interpreter(provisional).mockResolvedValueOnce(provisional).mockResolvedValueOnce(revised);
      const result = await retrieveCeoAnswer({ db, now, transcript, interpret });
      expect(interpret).toHaveBeenCalledTimes(2);
      expect(interpret).toHaveBeenNthCalledWith(2, expect.objectContaining({ transcript, scopeRecheck: {
        provisional, registeredTitle: project.name,
      } }));
      expect(result).toMatchObject({ kind: 'facts', facts: { entity: { id: project.id } } });
    });

    it.each([
      { operation: 'pic' },
      { divisionId: itDivision.id },
      { asOf: '2026-11-25' },
      { divisionExcerpt: 'khusus dari divisi finance' },
      { divisionExcerpt: 'divisi finance' },
      { subject: 'Rekonsiliasi Arsip' },
    ] satisfies Partial<CeoInterpretation>[])('preserves the untrimmed clarification after %o', async (change) => {
      const { db, calls } = database([project]);
      const interpret = interpreter(provisional).mockResolvedValueOnce(provisional).mockResolvedValueOnce({ ...revised, ...change });
      const result = await retrieveCeoAnswer({ db, now, transcript, interpret });
      expect(interpret).toHaveBeenCalledTimes(2);
      expect(result.kind).toBe('clarify');
      expect(result.context.pendingRequest?.subject).toBe(provisional.subject);
      expect(calls.some(({ sql }) => sql.includes('work.status'))).toBe(false);
    });

    it('keeps ordinary, already-grounded and competing registered subjects to one call', async () => {
      const knownLong = { ...project, id: web.id, name: 'Sinkronisasi Arsip Khusus' };
      for (const { figures, decision, text } of [
        { figures: [project], decision: { ...revised, divisionExcerpt: null },
          text: 'Apa status proyek Sinkronisasi Arsip di divisi Finance?' },
        { figures: [project], decision: { ...provisional, divisionExcerpt: revised.divisionExcerpt }, text: transcript },
        { figures: [project, knownLong], decision: provisional, text: transcript },
        { figures: [project], decision: { ...provisional, asOf: '2026-11-25' as const }, text: transcript },
      ]) {
        const { db } = database(figures);
        const interpret = interpreter(decision);
        await retrieveCeoAnswer({ db, now, transcript: text, interpret });
        expect(interpret).toHaveBeenCalledOnce();
      }
    });

    it('falls back promptly if the recheck provider does not honor its abort signal', async () => {
      const { db, calls } = database([project]);
      const interpret = interpreter(provisional).mockResolvedValueOnce(provisional)
        .mockImplementationOnce(async () => new Promise(() => {}));
      const observePhase = vi.fn();
      const result = await retrieveCeoAnswer({ db, now, transcript, interpret, observePhase });
      expect(interpret).toHaveBeenCalledTimes(2);
      expect(interpret.mock.calls[1][0].signal?.aborted).toBe(true);
      expect(observePhase).toHaveBeenCalledWith(expect.objectContaining({ stage: 'scope_recheck', outcome: 'timeout' }));
      expect(result.kind).toBe('clarify');
      expect(result.context.pendingRequest?.subject).toBe(provisional.subject);
      expect(calls.some(({ sql }) => sql.includes('work.status'))).toBe(false);
    });

    it('honors parent cancellation during the recheck without reading facts', async () => {
      const { db, calls } = database([project]);
      const parent = new AbortController();
      const reason = new Error('Turn replaced');
      const interpret = interpreter(provisional).mockResolvedValueOnce(provisional).mockImplementationOnce(async () => {
        parent.abort(reason);
        return new Promise(() => {});
      });
      await expect(retrieveCeoAnswer({ db, now, transcript, interpret, signal: parent.signal })).rejects.toBe(reason);
      expect(interpret).toHaveBeenCalledTimes(2);
      expect(calls.some(({ sql }) => sql.includes('work.status'))).toBe(false);
    });
  });
});
