import { Pool } from 'pg';
import { expect, test } from 'vitest';
import { devCeoEmail } from '../db/admin-account.js';
import { inTransaction } from '../db/transaction.js';
import { choiceStillMatches, searchSemantic } from '../modules/ai/retrieval/candidates.js';
import type { CeoRequest } from '../modules/ai/retrieval/request-types.js';
import type { RetrievalDatabase } from '../modules/ai/retrieval/schema.js';
import { loadCeoIdentity } from '../modules/auth/ceo-access.js';
import { prepareAdminFixture } from './admin-fixture.js';

const model = 'fixture-model';
const vector = [1, ...Array<number>(1535).fill(0)];
type Job = { resource_id: string; description: string; lease_id: string; content_hash: string; attempts: number };

test('embeddings use current documents and enforce version, lease expiry, archive and deletion boundaries', async () => {
  const fixture = await prepareAdminFixture();
  const connection = new Pool({ connectionString: fixture.config.DATABASE_URL });
  try {
    await fixture.login(devCeoEmail);
    const { rows: [owner] } = await fixture.db.query<{ userId: string; sessionId: string }>(`
      SELECT profile.id AS "userId", session.id AS "sessionId"
      FROM "user" profile JOIN session ON session."userId" = profile.id WHERE profile.email = $1`, [devCeoEmail]);
    const db: RetrievalDatabase = {
      query: (sql, parameters) => inTransaction(connection, async (snapshot) => {
        expect(await loadCeoIdentity(snapshot, owner.userId, owner.sessionId)).toBeTruthy();
        return snapshot.query(sql, parameters);
      }, { readOnly: true }),
    };
    const { rows: [division] } = await fixture.db.query<{ id: string; name: string; code: string }>(`
      INSERT INTO divisions (name) VALUES ('Operasi Embedding') RETURNING id, name, code`);
    await fixture.db.query(`UPDATE work_search_embeddings SET next_attempt_at = 'infinity'`);
    const createProject = async (name: string) => {
      const { rows: [project] } = await fixture.db.query<{ id: string; name: string }>(`
        INSERT INTO projects (division_id, name, description) VALUES ($1, $2, $3) RETURNING id, name`,
      [division.id, name, 'deskripsi awal']);
      return project;
    };
    const claim = async (forModel = model) => (await connection.query<Job>(
      'SELECT * FROM public.claim_work_search_embeddings($1, 1)', [forModel])).rows;
    const complete = async (job: Job) => (await connection.query<{ completed: boolean }>(
      `SELECT public.complete_work_search_embedding('project', $1, $2, $3, $4::vector) AS completed`,
      [job.resource_id, job.lease_id, model, JSON.stringify(vector)])).rows[0].completed;
    const retry = async (job: Job, seconds: number) => (await connection.query<{ retried: boolean }>(
      `SELECT public.retry_work_search_embedding('project', $1, $2, $3) AS retried`,
      [job.resource_id, job.lease_id, seconds])).rows[0].retried;
    const search = async (selectedModel = model) => searchSemantic(db, { intent: 'status', subject: 'dermaga', latest: false,
      division, entityKind: 'project' }, async () => ({ model: selectedModel, vector }), 1_500);

    const project = await createProject('Pembenahan Dermaga');
    const [original] = await claim();
    expect(original).toMatchObject({ resource_id: project.id, description: 'deskripsi awal' });
    expect(await complete(original)).toBe(true);
    expect(await search()).toMatchObject({ outcome: 'observed', candidates: [{ id: project.id, name: project.name }] });
    expect(await search('different-model')).toEqual({ outcome: 'observed', candidates: [] });
    await fixture.db.query(`UPDATE projects SET status = 'done', name = name, description = description WHERE id = $1`, [project.id]);
    expect(await claim()).toEqual([]);
    expect(await search()).toMatchObject({ outcome: 'observed', candidates: [{ id: project.id, name: project.name }] });

    // A row whose vector/source metadata drifts can never be read by a CEO.
    await fixture.db.query(`UPDATE work_search_embeddings SET description = 'versi penyimpanan usang' WHERE resource_id = $1`, [project.id]);
    expect(await search()).toEqual({ outcome: 'observed', candidates: [] });
    await fixture.db.query(`UPDATE projects SET description = 'deskripsi terbaru' WHERE id = $1`, [project.id]);
    expect(await search()).toEqual({ outcome: 'observed', candidates: [] });
    expect(await complete(original)).toBe(false);
    const [newLease] = await claim();
    expect(newLease).toMatchObject({ resource_id: project.id, description: 'deskripsi terbaru', attempts: 1 });
    expect(newLease.content_hash).not.toBe(original.content_hash);
    await fixture.db.query(`UPDATE work_search_embeddings SET lease_expires_at = now() - interval '1 minute' WHERE resource_id = $1`, [project.id]);
    expect(await complete(newLease)).toBe(false);
    expect(await retry(newLease, 60)).toBe(false);
    const [replacement] = await claim();
    expect(replacement.lease_id).not.toBe(newLease.lease_id);
    expect(await retry(newLease, 60)).toBe(false);
    expect(await retry(replacement, 60)).toBe(true);
    expect(await claim()).toEqual([]);
    await fixture.db.query(`UPDATE work_search_embeddings SET next_attempt_at = now() - interval '1 minute' WHERE resource_id = $1`, [project.id]);
    const [ready] = await claim();
    expect(await complete(ready)).toBe(true);
    const matching = await search();
    expect(matching).toMatchObject({ outcome: 'observed', candidates: [{ id: project.id, name: project.name }] });
    const selected = matching.candidates[0];
    const selectedRequest: CeoRequest = { intent: 'status', entityKind: 'project', latest: false,
      subject: selected.name, division };
    expect(await choiceStillMatches(db, selectedRequest, selected)).toBe(true);

    const pending = await createProject('Gerbang Arsip');
    const [archivedLease] = await claim();
    expect(archivedLease.resource_id).toBe(pending.id);
    await fixture.db.query(`UPDATE divisions SET status = 'archived' WHERE id = $1`, [division.id]);
    expect(await complete(archivedLease)).toBe(false);
    expect(await claim('different-model')).toEqual([]);
    expect(await search()).toEqual({ outcome: 'observed', candidates: [] });
    expect(await choiceStillMatches(db, selectedRequest, selected)).toBe(false);
    expect(await choiceStillMatches(db, { ...selectedRequest, asOf: new Date(Date.now() + 60_000).toISOString() }, selected)).toBe(true);
    await fixture.db.query(`DELETE FROM projects WHERE id = $1`, [project.id]);
    expect((await fixture.db.query(`SELECT 1 FROM work_search_embeddings WHERE resource_id = $1`, [project.id])).rowCount).toBe(0);
  } finally {
    await connection.end();
    await fixture.close();
  }
}, 30_000);
