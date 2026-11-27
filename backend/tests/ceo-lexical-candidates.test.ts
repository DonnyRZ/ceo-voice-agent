import { Pool } from 'pg';
import { expect, test } from 'vitest';
import { devCeoEmail } from '../db/admin-account.js';
import { it as itDivision } from '../db/seed-data.js';
import { inTransaction } from '../db/transaction.js';
import { loadCeoIdentity } from '../modules/auth/ceo-access.js';
import type { CeoInterpretation } from '../modules/ai/retrieval/interpretation.js';
import { retrieveCeoAnswer, type RetrievalDatabase } from '../modules/ai/retrieval/index.js';
import { prepareAdminFixture } from './admin-fixture.js';

function lookup(subject: string, workKind: 'project' | 'task'): CeoInterpretation {
  return { kind: 'lookup', operation: 'status', target: 'named_work', subject, workKind,
    divisionId: null, from: null, to: null, asOf: null, statuses: [], selectionId: null,
    clarify: null, clear: [], correction: null, divisionExcerpt: null, summaryDetail: null };
}

test('partial lexical candidates tolerate adjacent request words while full-title proof controls facts', async () => {
  const fixture = await prepareAdminFixture();
  const runtime = new Pool({ connectionString: fixture.config.DATABASE_URL, connectionTimeoutMillis: 5_000 });
  try {
    await fixture.login(devCeoEmail);
    const { rows: [owner] } = await fixture.db.query<{ userId: string; sessionId: string }>(`
      SELECT profile.id AS "userId", session.id AS "sessionId"
      FROM "user" profile JOIN session ON session."userId" = profile.id
      WHERE profile.email = $1 ORDER BY session."createdAt" DESC LIMIT 1`, [devCeoEmail]);
    const read = <T>(run: (db: RetrievalDatabase) => Promise<T>, snapshot = false) => inTransaction(runtime, async (db) => {
      if (snapshot) await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await db.query("SET LOCAL statement_timeout = '250ms'");
      expect(await loadCeoIdentity(db, owner.userId, owner.sessionId)).toBeTruthy();
      return run(db);
    }, { readOnly: true });
    const db: RetrievalDatabase = {
      query: (sql, parameters) => read((connection) => connection.query(sql, parameters)),
      withSnapshot: (run) => read(run, true),
    };
    const { rows: projects } = await fixture.db.query<{ id: string; name: string }>(`
      INSERT INTO projects (division_id, name) SELECT $1, unnest($2::text[]) RETURNING id, name`,
    [itDivision, ['Pemeriksaan Pelabuhan', 'Pemeriksaan Pengiriman', 'Proyek Amanah', 'Peninjauan', 'Peninjauan Tambahan']]);
    const { rows: [literalTask] } = await fixture.db.query<{ id: string; title: string }>(`
      INSERT INTO tasks (division_id, date, title, description, project_id, pic_id, status)
      SELECT division_id, date, 'Tugas Peninjauan', description, project_id, pic_id, 'pending'
      FROM tasks WHERE division_id = $1 ORDER BY id LIMIT 1 RETURNING id, title`, [itDivision]);

    for (const [kind, subject] of [
      ['task', 'tugas uji'], ['task', 'pekerjaan uji'],
      ['project', 'proyek pemeriksaan'], ['project', 'pekerjaan pemeriksaan'],
    ] as const) {
      const answer = await retrieveCeoAnswer({ db, transcript: `Bagaimana status ${subject}?`, interpret: async () => lookup(subject, kind) });
      expect(answer.kind).toBe('clarify');
      expect(answer.facts).toBeUndefined();
      expect(answer.context.choices?.length).toBeGreaterThanOrEqual(2);
      expect(answer.context.choices?.every((choice) => choice.kind === kind)).toBe(true);
      expect(answer.context.choices?.some((choice) => choice.name.includes(kind === 'task' ? 'Uji' : 'Pemeriksaan'))).toBe(true);
    }

    await fixture.db.query(`
      INSERT INTO tasks (division_id, date, title, description, project_id, pic_id, status)
      SELECT original.division_id, original.date, 'Pekerjaan Operasional ' || number,
        'Catatan beban pencarian', original.project_id, original.pic_id, 'pending'
      FROM (SELECT * FROM tasks ORDER BY id LIMIT 1) AS original
      CROSS JOIN generate_series(1, 2_000) AS number`);
    await fixture.db.query('ANALYZE tasks');
    const crowded = await retrieveCeoAnswer({ db, transcript: 'Bagaimana status pekerjaan uji?',
      interpret: async () => lookup('pekerjaan uji', 'task') });
    expect(crowded.kind).toBe('clarify');
    expect(crowded.facts).toBeUndefined();
    expect(crowded.context.choices?.slice(0, 2).every(({ name }) => name.startsWith('Uji '))).toBe(true);

    for (const [kind, work] of [
      ['project', projects.find(({ name }) => name === 'Proyek Amanah')!],
      ['task', { id: literalTask.id, name: literalTask.title }],
    ] as const) {
      const answer = await retrieveCeoAnswer({ db, transcript: `Apa status ${kind === 'task' ? 'tugas' : 'proyek'} ${work.name}?`,
        interpret: async () => lookup(work.name, kind) });
      expect(answer).toMatchObject({ kind: 'facts', facts: { entity: { id: work.id, name: work.name }, status: 'pending' } });
    }

    const unknown = await retrieveCeoAnswer({ db, transcript: 'Apa status proyek Peninjauan Tambahan Delta?',
      interpret: async () => lookup('Peninjauan Tambahan Delta', 'project') });
    expect(unknown.kind).toBe('clarify');
    expect(unknown.facts).toBeUndefined();
    expect(unknown.context.choices?.some(({ name }) => name === 'Peninjauan Tambahan')).toBe(true);
  } finally {
    await runtime.end();
    await fixture.close();
  }
}, 30_000);
