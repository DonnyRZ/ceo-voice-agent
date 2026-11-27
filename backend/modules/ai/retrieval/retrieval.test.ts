import type { QueryResultRow } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { prepareCeoCandidates, retrieveCeoAnswer } from './index.js';
import { parseCeoIntent } from './intent.js';
import type { RetrievalDatabase } from './schema.js';

const now = new Date('2026-11-26T01:30:00.000Z');
const itDivision = { id: 'ea0e00b0-101c-4000-8000-000000000001', name: 'IT', code: 'IT' };
const finance = { id: 'ea0e00b0-101c-4000-8000-000000000002', name: 'Finance', code: 'FIN' };
const divisions = [itDivision, finance];
const mobile = { kind: 'project', id: 'ea0e00b0-301c-4000-8000-000000000001', name: 'Aplikasi A Mobile', divisionName: 'IT', divisionId: itDivision.id, score: 1 };
const web = { ...mobile, id: 'ea0e00b0-301c-4000-8000-000000000002', name: 'Aplikasi A Web', score: 0.82 };
const empty = { pending: 0, on_progress: 0, done: 0, total: 0 };

function database(candidates = [mobile]) {
  const calls: { sql: string; parameters: unknown[] }[] = [];
  const db: RetrievalDatabase = {
    async query<Row extends QueryResultRow>(sql: string, parameters: unknown[] = []) {
      calls.push({ sql, parameters });
      let rows: unknown[];
      if (sql.includes('SELECT id, name, code')) rows = divisions;
      else if (sql.includes('ceo_search_work')) rows = parameters[0] === 'project'
        ? candidates.filter(({ name }) => !parameters[4] || name.toLowerCase() === parameters[1]) : [];
      else if (sql.includes('work_search_embeddings')) rows = [{ ...mobile, score: 0.82 }];
      else if (sql.includes('WITH selected AS MATERIALIZED')) rows = [{ tasks: [], counts: empty }];
      else if (sql.includes('work.status')) rows = [{ status: 'on_progress', name: mobile.name, divisionName: 'IT', updatedAt: now }];
      else throw new Error('Unexpected SQL in fake DB.');
      return { rows: rows as Row[] };
    },
  };
  return { db, calls };
}

describe('deterministic CEO retrieval', () => {
  it('parses exact names, division scope, and Indonesian rolling dates', () => {
    expect(parseCeoIntent('Bagaimana progres Aplikasi A Mobile dari divisi IT?', divisions, now)).toMatchObject({
      kind: 'request', request: { intent: 'status', subject: 'aplikasi a mobile', division: itDivision },
    });
    expect(parseCeoIntent('Rekap tugas IT dua bulan terakhir', divisions, now)).toMatchObject({
      kind: 'request', request: { intent: 'summary', entityKind: 'task', division: itDivision, period: { from: '2026-09-27', to: '2026-11-26' } },
    });
  });

  it('keeps a historical cutoff distinct from task-date filters', () => {
    const result = parseCeoIntent('Status tugas Uji notifikasi per akhir Oktober 2026', divisions, now);
    expect(result).toMatchObject({ kind: 'request', request: {
      intent: 'status', entityKind: 'task', subject: 'uji notifikasi', period: undefined,
      asOf: '2026-10-31T23:59:59.999999+07:00',
    } });
    expect(parseCeoIntent('Rekap divisi IT dari Oktober sampai November per 24 November 2026', divisions, now)).toMatchObject({
      kind: 'request', request: { period: { from: '2026-10-01', to: '2026-11-30' }, asOf: '2026-11-24T23:59:59.999999+07:00' },
    });
    expect(parseCeoIntent('Status Uji notifikasi per 33 Oktober', divisions, now).kind).toBe('clarify');
  });

  it('chooses a cutoff for an explicit past status but task dates for listings', () => {
    const entity = { kind: 'task' as const, id: 'ea0e00b0-401c-4000-8000-000000000002', name: 'Uji notifikasi' };
    const context = { request: { intent: 'status' as const, latest: false, entity, entityKind: 'task' as const } };
    expect(parseCeoIntent('Apa status tugas itu pada akhir bulan lalu?', divisions, now, context)).toMatchObject({
      kind: 'request', request: { entity, asOf: '2026-10-31T23:59:59.999999+07:00', period: undefined },
    });
    expect(parseCeoIntent('Siapa PIC tugas Uji notifikasi pada tanggal 25 Oktober?', divisions, now)).toMatchObject({
      kind: 'request', request: { intent: 'pic', subject: 'uji notifikasi', asOf: '2026-10-25T23:59:59.999999+07:00', period: undefined },
    });
    expect(parseCeoIntent('Tugas apa saja bulan lalu?', divisions, now)).toMatchObject({
      kind: 'request', request: { intent: 'summary', period: { from: '2026-10-01', to: '2026-10-31' }, asOf: undefined },
    });
  });

  it('carries an identified entity and changes scope on a correction', async () => {
    const { db } = database();
    const initial = await retrieveCeoAnswer({ db, now, transcript: 'Bagaimana progres Aplikasi A Mobile dari divisi IT?' });
    expect(initial).toMatchObject({ kind: 'facts', facts: { status: 'on_progress', entity: { id: mobile.id } } });
    expect(parseCeoIntent('Siapa PIC-nya?', divisions, now, initial.context)).toMatchObject({
      kind: 'request', request: { intent: 'pic', entity: { id: mobile.id }, division: itDivision },
    });
    expect(parseCeoIntent('Bukan IT, Finance', divisions, now, initial.context)).toMatchObject({
      kind: 'request', request: { intent: 'status', subject: 'aplikasi a mobile', entity: undefined, division: finance },
    });
  });

  it('answers a direct update-time follow-up with the recorded Jakarta timestamp', async () => {
    const { db, calls } = database();
    const initial = await retrieveCeoAnswer({ db, now, transcript: 'Progres proyek Aplikasi A Mobile' });
    calls.length = 0;
    const updated = await retrieveCeoAnswer({ db, now, transcript: 'Kapan terakhir diperbarui?', context: initial.context });
    expect(updated).toMatchObject({ kind: 'facts', facts: { entity: { id: mobile.id }, updatedAt: now.toISOString() } });
    expect(updated.text).toMatch(/^Pembaruan terakhir proyek Aplikasi A Mobile/);
    expect(updated.text).toContain('26 November 2026');
    expect(updated.text).toContain('08.30 WIB');
    expect(calls.some(({ sql }) => sql.includes('ceo_search_work'))).toBe(false);
  });

  it('requires confirmation before turning fuzzy candidates into facts', async () => {
    const { db, calls } = database([{ ...mobile, score: 0.82 }, web]);
    const clarify = await retrieveCeoAnswer({ db, now, transcript: 'Progres proyek Aplikasi A?' });
    expect(clarify.kind).toBe('clarify');
    expect(clarify.facts).toBeUndefined();
    expect(clarify.context.choices?.map(({ name }) => name)).toEqual([mobile.name, web.name]);
    expect(calls.some(({ sql }) => sql.includes('work.status'))).toBe(false);
    const confirmed = await retrieveCeoAnswer({ db, now, transcript: 'Yang mobile', context: clarify.context });
    expect(confirmed).toMatchObject({ kind: 'facts', facts: { entity: { id: mobile.id } } });
    const rejected = await retrieveCeoAnswer({ db, now, transcript: 'Bukan yang mobile', context: clarify.context });
    expect(rejected.kind).toBe('clarify');
    expect(rejected.facts).toBeUndefined();
    const action = await retrieveCeoAnswer({ db, now, transcript: 'Hapus yang kedua', context: clarify.context });
    expect(action.kind).toBe('unsupported');
  });

  it('keeps vector candidates non-factual and times out a slow provider', async () => {
    const { db } = database([]);
    const embed = vi.fn(async () => ({ model: 'embedding-test', vector: Array<number>(1536).fill(1) }));
    const first = await retrieveCeoAnswer({ db, now, transcript: 'Progres proyek tambang', embed });
    expect(first.kind).toBe('clarify');
    expect(first.facts).toBeUndefined();
    const slow: typeof embed = vi.fn(() => new Promise(() => {}));
    const second = await retrieveCeoAnswer({ db, now, transcript: 'Progres proyek tambang', embed: slow, embeddingDeadlineMs: 20 });
    expect(second.kind).toBe('no_match');
    expect(slow).toHaveBeenCalledOnce();
  });

  it('prepares candidates without running factual or embedding requests', async () => {
    const { db, calls } = database();
    const transcript = 'Progres Aplikasi A Mobile';
    const embed = vi.fn();
    const prepared = await prepareCeoCandidates({ db, transcript, now, embed });
    expect(embed).not.toHaveBeenCalled();
    expect(calls.some(({ sql }) => sql.includes('work.status'))).toBe(false);
    calls.length = 0;
    const resolved = await retrieveCeoAnswer({ db, transcript, now, prepared, embed });
    expect(resolved.kind).toBe('facts');
    expect(calls.some(({ sql }) => sql.includes('ceo_search_work'))).toBe(false);
  });

  it('rejects requests to mutate company records', async () => {
    const { db } = database();
    const outcome = await retrieveCeoAnswer({ db, now, transcript: 'Tolong ubah status proyek Aplikasi A Mobile' });
    expect(outcome.kind).toBe('unsupported');
    expect(outcome.facts).toBeUndefined();
  });
});
