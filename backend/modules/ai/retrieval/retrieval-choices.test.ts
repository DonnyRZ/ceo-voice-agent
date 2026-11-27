import { describe, expect, it } from 'vitest';
import { retrieveCeoAnswer } from './index.js';
import { now, itDivision, finance, mobile, web, noLookup, lookup, interpreter, database } from './retrieval-test-fixture.js';

describe('CEO candidate selection and unresolved choices', () => {
  it('checks choices and does not resurrect a stale choice after a correction', async () => {
    const { db, calls } = database([{ ...mobile, score: 0.82 }, web]);
    const interpret = interpreter(lookup({ subject: 'Aplikasi A' }));
    const clarify = await retrieveCeoAnswer({ db, interpret, now, transcript: 'Aplikasi A itu sudah tuntas belum?' });
    expect(clarify.kind).toBe('clarify');
    expect(clarify.facts).toBeUndefined();
    expect(clarify.context.choices?.map(({ id }) => id)).toEqual([mobile.id, web.id]);
    expect(clarify.text).toBe(`Apakah yang Anda maksud proyek ${mobile.name} dari divisi ${mobile.divisionName} atau proyek ${web.name} dari divisi ${web.divisionName}?`);
    expect(calls.some(({ sql }) => sql.includes('work.status'))).toBe(false);

    interpret.mockResolvedValue({ ...noLookup, kind: 'select_candidate', selectionId: web.id });
    const selected = await retrieveCeoAnswer({ db, interpret, now, transcript: 'Pilihan kedua.', context: clarify.context });
    expect(selected).toMatchObject({ kind: 'facts', facts: { entity: { id: web.id } } });

    calls.length = 0;
    interpret.mockResolvedValue({ ...noLookup, kind: 'select_candidate', selectionId: finance.id });
    const stale = await retrieveCeoAnswer({ db, interpret, now, transcript: 'Maksud saya yang dari Finance.', context: clarify.context });
    expect(stale.facts).toBeUndefined();
    expect(calls.some(({ sql }) => sql.includes('work.status'))).toBe(false);
  });

  it('checks the spoken option against the chosen ID and rechecks the original label before reading', async () => {
    const rows = [{ ...mobile, score: 0.82 }, web];
    const { db, calls } = database(rows);
    const first = await retrieveCeoAnswer({ db, now, transcript: 'Status proyek Aplikasi A?',
      interpret: interpreter(lookup({ subject: 'Aplikasi A' })) });
    expect(first.context.choices).toHaveLength(2);
    const selection = interpreter({ ...noLookup, kind: 'select_candidate', selectionId: web.id });
    const input = { db, now, interpret: selection, context: first.context };
    const wrongOrdinal = await retrieveCeoAnswer({ ...input, transcript: 'Pilihan pertama.' });
    expect(wrongOrdinal.kind).toBe('clarify');
    const rejected = await retrieveCeoAnswer({ ...input, transcript: 'Bukan pilihan kedua.' });
    expect(rejected.kind).toBe('clarify');
    rows[1] = { ...web, name: 'Aplikasi A Browser' };
    const renamed = await retrieveCeoAnswer({ ...input, transcript: 'Pilihan kedua.' });
    expect(renamed.kind).toBe('clarify');
    expect(calls.some(({ sql }) => sql.includes('work.status'))).toBe(false);
  });

  it('does not offer indistinguishable labels or confirm one after a same-scope duplicate appears', async () => {
    const rows = [{ ...mobile, score: 0.82 }, web];
    const { db } = database(rows);
    const first = await retrieveCeoAnswer({ db, now, transcript: 'Status proyek Aplikasi A?',
      interpret: interpreter(lookup({ subject: 'Aplikasi A' })) });
    rows.push({ ...web, id: 'ea0e00b0-301c-4000-8000-000000000003', name: 'Aplikasi—A Web' });
    const confirm = await retrieveCeoAnswer({ db, now, transcript: 'Pilihan kedua.', context: first.context,
      interpret: interpreter({ ...noLookup, kind: 'select_candidate', selectionId: web.id }) });
    expect(confirm.kind).toBe('clarify');
    const duplicate = await retrieveCeoAnswer({ db, now, transcript: 'Status proyek Aplikasi A Web?',
      interpret: interpreter(lookup({ subject: 'Aplikasi A Web' })) });
    expect(duplicate.kind).toBe('clarify');
    expect(duplicate.context.choices).toBeUndefined();
  });

  it('does not revive an older grounded entity after an unresolved option is rejected', async () => {
    const { db, calls } = database([mobile, web]);
    const first = await retrieveCeoAnswer({ db, now, transcript: 'Status proyek Aplikasi A Mobile?',
      interpret: interpreter(lookup()) });
    const pending = await retrieveCeoAnswer({ db, now, transcript: 'Status proyek Aplikasi A?', context: first.context,
      interpret: interpreter(lookup({ subject: 'Aplikasi A' })) });
    const rejected = await retrieveCeoAnswer({ db, now, transcript: 'Bukan yang itu.', context: pending.context,
      interpret: interpreter({ ...noLookup, kind: 'clarify', clarify: 'project_or_task' }) });
    expect(rejected.context.choices).toBeUndefined();
    calls.length = 0;
    const ambiguous = await retrieveCeoAnswer({ db, now, transcript: 'Status yang tadi?', context: rejected.context,
      interpret: interpreter(lookup({ target: 'previous_work', operation: null, subject: null, workKind: null })) });
    expect(ambiguous.kind).toBe('clarify');
    expect(calls.some(({ sql }) => sql.includes('work.status'))).toBe(false);
  });

  it('retains the ambiguous title and options for a date-only correction until explicit selection', async () => {
    const archive = { ...mobile, id: web.id, name: 'Sinkronisasi Arsip', historicalStatus: 'pending' };
    const financeArchive = { ...archive, id: 'ea0e00b0-301c-4000-8000-000000000100',
      divisionId: finance.id, divisionName: finance.name, historicalStatus: 'on_progress' };
    const { db, calls } = database([mobile, archive, financeArchive]);
    const confirmed = await retrieveCeoAnswer({ db, now, transcript: 'Status proyek Aplikasi A Mobile?', interpret: interpreter(lookup()) });
    const pending = await retrieveCeoAnswer({ db, now, transcript: 'Status proyek Sinkronisasi Arsip?', context: confirmed.context,
      interpret: interpreter(lookup({ subject: archive.name })) });
    expect(pending.context.choices).toHaveLength(2);
    calls.length = 0;
    const historical = await retrieveCeoAnswer({ db, now, transcript: 'Per 24 November saja.', context: pending.context,
      interpret: interpreter(lookup({ target: 'previous_work', operation: null, subject: archive.name, asOf: '2026-11-24' })) });
    expect(historical.kind).toBe('clarify');
    expect(historical.context.choices).toEqual(pending.context.choices);
    expect(historical.context.pendingRequest).toMatchObject({ subject: 'sinkronisasi arsip', asOf: '2026-11-24T23:59:59.999999+07:00' });
    expect(historical.facts).toBeUndefined();
    expect(calls.some(({ sql }) => sql.includes('ceo_work_status_as_of'))).toBe(false);
    const selected = await retrieveCeoAnswer({ db, now, transcript: 'Yang dari divisi Finance.', context: historical.context,
      interpret: interpreter({ ...noLookup, kind: 'select_candidate', selectionId: financeArchive.id }) });
    expect(selected).toMatchObject({ kind: 'facts', facts: { entity: { id: financeArchive.id }, status: 'on_progress',
      asOf: '2026-11-24T23:59:59.999999+07:00' } });
  });

  it('does not treat missing historical data as a selection or renumber options', async () => {
    const archive = { ...mobile, name: 'Sinkronisasi Arsip', recordedSince: '2026-11-20' };
    const financeArchive = { ...archive, id: web.id, divisionId: finance.id, divisionName: finance.name, recordedSince: '2026-11-25' };
    const { db, calls } = database([archive, financeArchive]);
    const pending = await retrieveCeoAnswer({ db, now, transcript: 'Status proyek Sinkronisasi Arsip?',
      interpret: interpreter(lookup({ subject: archive.name })) });
    expect(pending.context.choices).toHaveLength(2);
    calls.length = 0;
    const inputs = { db, now, transcript: 'Per 24 November saja.',
      interpret: interpreter(lookup({ target: 'previous_work', operation: null, subject: null, asOf: '2026-11-24' })) };
    const historical = await retrieveCeoAnswer({ ...inputs, context: pending.context });
    expect(historical.context.choices).toBeUndefined();
    expect(historical.context.needsConfirmation).toBe(true);
    for (const result of [historical, await retrieveCeoAnswer({ ...inputs, context: historical.context })]) {
      expect(result.kind).toBe('clarify');
      expect(result.facts).toBeUndefined();
    }
    expect(calls.some(({ sql }) => sql.includes('ceo_work_status_as_of'))).toBe(false);
    const oldOrdinal = await retrieveCeoAnswer({ db, now, transcript: 'Pilihan pertama.', context: historical.context,
      interpret: interpreter({ ...noLookup, kind: 'select_candidate', selectionId: archive.id }) });
    expect(oldOrdinal.kind).toBe('clarify');
    const explicitScope = await retrieveCeoAnswer({ db, now, transcript: 'Yang di divisi IT.', context: historical.context,
      interpret: interpreter(lookup({ target: 'previous_work', operation: null, subject: null, divisionId: itDivision.id })) });
    expect(explicitScope).toMatchObject({ kind: 'facts', facts: { entity: { id: archive.id }, asOf: '2026-11-24T23:59:59.999999+07:00' } });
  });

  it('preserves an unconfirmed spoken title and the proposed project through a date-only correction', async () => {
    const gate = { ...mobile, name: 'Pembaruan Gerbang', recordedSince: '2026-11-24', historicalStatus: 'pending' };
    const { db } = database([gate]);
    const pending = await retrieveCeoAnswer({ db, now, transcript: 'Apa status proyek pembaruan dewan sekarang?',
      interpret: interpreter(lookup({ subject: 'pembaruan dewan' })) });
    expect(pending.context.choices).toMatchObject([{ id: gate.id }]);
    const historical = await retrieveCeoAnswer({ db, now, context: pending.context,
      transcript: 'Maksud saya, status proyek tadi pada tanggal dua puluh lima November dua ribu dua puluh enam.',
      interpret: interpreter(lookup({ target: 'previous_work', subject: null, asOf: '2026-11-25' })) });
    expect(historical).toMatchObject({ kind: 'clarify', context: {
      choices: [{ id: gate.id }], pendingRequest: { subject: 'pembaruan dewan', asOf: '2026-11-25T23:59:59.999999+07:00' },
    } });
    const confirmed = await retrieveCeoAnswer({ db, now, context: historical.context, transcript: 'Iya.',
      interpret: interpreter({ ...noLookup, kind: 'select_candidate', selectionId: gate.id }) });
    expect(confirmed).toMatchObject({ kind: 'facts', facts: { entity: { id: gate.id }, status: 'pending',
      asOf: '2026-11-25T23:59:59.999999+07:00' } });
  });
});
