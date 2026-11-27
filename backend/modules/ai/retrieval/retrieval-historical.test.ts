import { describe, expect, it } from 'vitest';
import { retrieveCeoAnswer } from './index.js';
import { now, itDivision, finance, mobile, web, lookup, interpreter, exactRead, database } from './retrieval-test-fixture.js';

describe('CEO historical cutoffs and unavailable history', () => {
  it('keeps historical scope in a division correction and clears it only when requested', async () => {
    const other = { ...mobile, id: web.id, divisionId: finance.id, divisionName: finance.name };
    const { db, calls } = database([mobile, other]);
    const first = await retrieveCeoAnswer({ db, now, transcript: 'Status proyek Aplikasi A Mobile di IT per 24 November?',
      interpret: interpreter(lookup({ divisionId: itDivision.id, asOf: '2026-11-24' })) });
    expect(first).toMatchObject({ kind: 'facts', facts: { entity: { id: mobile.id }, asOf: '2026-11-24T23:59:59.999999+07:00' } });
    const corrected = await retrieveCeoAnswer({ db, now, transcript: 'Yang di Finance sebenarnya.', context: first.context,
      interpret: interpreter(lookup({ target: 'previous_work', subject: null, divisionId: finance.id })) });
    expect(corrected).toMatchObject({ kind: 'facts', facts: { entity: { id: other.id }, asOf: '2026-11-24T23:59:59.999999+07:00' } });
    calls.length = 0;
    const current = await retrieveCeoAnswer({ db, now, transcript: 'Sekarang saja.', context: corrected.context,
      interpret: interpreter(lookup({ target: 'previous_work', subject: null, clear: ['asOf'] })) });
    expect(current).toMatchObject({ kind: 'facts', facts: { entity: { id: other.id } } });
    expect(current.facts?.asOf).toBeUndefined();
    expect(calls.some(({ sql }) => sql.includes('ceo_work_status_as_of'))).toBe(false);
  });

  it('accepts a confirmed title echoed by interpretation of a historical cutoff correction', async () => {
    const gate = { ...mobile, id: 'ea0e00b0-301c-4000-8000-000000000103', name: 'Pembaruan Gerbang',
      status: 'done', historicalStatus: 'pending' };
    const { db, calls } = database([gate]);
    const first = await retrieveCeoAnswer({ db, now, transcript: 'Apa status proyek Pembaruan Gerbang sekarang?',
      interpret: interpreter(lookup({ subject: gate.name })) });
    expect(first).toMatchObject({ kind: 'facts', facts: { entity: { id: gate.id }, status: 'done' } });
    calls.length = 0;
    const historical = await retrieveCeoAnswer({ db, now, context: first.context,
      transcript: 'Maksud saya, status proyek tadi pada tanggal dua puluh lima November dua ribu dua puluh enam.',
      interpret: interpreter(lookup({ target: 'previous_work', subject: gate.name, asOf: '2026-11-25' })) });
    expect(historical).toMatchObject({ kind: 'facts', facts: { entity: { id: gate.id }, status: 'pending',
      asOf: '2026-11-25T23:59:59.999999+07:00' } });
    expect(calls.some(({ sql }) => exactRead(sql))).toBe(false);
  });

  it('names the interpreted cutoff after an exact current title check without reading current facts', async () => {
    const gate = { ...mobile, name: 'Pembaruan Gerbang', status: 'done', historicalStatus: 'pending', recordedSince: '2026-11-24' };
    const { db, calls } = database([gate]);
    const result = await retrieveCeoAnswer({ db, now,
      transcript: 'Bagaimana status proyek pembaruan gerbang pada tanggal 25 November 2020 an',
      interpret: interpreter(lookup({ subject: 'proyek pembaruan gerbang', asOf: '2020-11-25' })) });
    expect(result.kind).toBe('clarify');
    expect(result.text).toContain('Pembaruan Gerbang per 25 November 2020');
    expect(result.facts).toBeUndefined();
    expect(result.context.request).toBeUndefined();
    expect(result.context.pendingRequest?.entity).toBeUndefined();
    expect(calls.some(({ sql }) => sql.includes('work.status') || sql.includes('ceo_search_work'))).toBe(false);

    const corrected = await retrieveCeoAnswer({ db, now, context: result.context,
      transcript: 'Maksud saya 25 November 2026.',
      interpret: interpreter(lookup({ target: 'previous_work', operation: null, subject: null, asOf: '2026-11-25' })) });
    expect(corrected).toMatchObject({ kind: 'facts', facts: { status: 'pending', asOf: '2026-11-25T23:59:59.999999+07:00' } });
  });

  it('keeps a title typo separate from a verified title with missing history', async () => {
    const gate = { ...mobile, name: 'Pembaruan Gerbang', recordedSince: '2026-11-24' };
    const { db } = database([gate]);
    const result = await retrieveCeoAnswer({ db, now,
      transcript: 'Apa status proyek Pembaruuan Gerban pada 25 November 2020?',
      interpret: interpreter(lookup({ subject: 'Pembaruuan Gerban', asOf: '2020-11-25' })) });
    expect(result.kind).toBe('no_match');
    expect(result.text).not.toContain('25 November 2020');
    expect(result.facts).toBeUndefined();
  });

  it('prioritizes exact competing historical titles over a current date-gap diagnosis', async () => {
    const gate = { ...mobile, name: 'Pembaruan Gerbang', recordedSince: '2026-11-24' };
    const old = { ...web, name: 'Pemulihan Akun', recordedSince: '2020-11-24' };
    const { db, calls } = database([gate, old]);
    const result = await retrieveCeoAnswer({ db, now,
      transcript: 'Apa status proyek Pembaruan Gerbang atau Pemulihan Akun pada 25 November 2020?',
      interpret: interpreter(lookup({ subject: gate.name, asOf: '2020-11-25' })) });
    expect(result.kind).toBe('clarify');
    expect(result.text).not.toContain('25 November 2020');
    expect(result.facts).toBeUndefined();
    expect(calls.filter(({ sql }) => exactRead(sql))).toHaveLength(1);
  });
});
