import { Pool, type PoolClient } from 'pg';
import { expect, test, vi } from 'vitest';
import { devCeoEmail } from '../db/admin-account.js';
import { finance as financeDivision, it as itDivision } from '../db/seed-data.js';
import { inTransaction } from '../db/transaction.js';
import { loadCeoIdentity } from '../modules/auth/ceo-access.js';
import { prepareAdminFixture } from './admin-fixture.js';

type Owner = { userId: string; sessionId: string };
type Scope = { id: string; name: string; code: string };
type Evidence = {
  outcome: 'unauthorized' | 'scope_changed' | 'missing' | 'changed' | 'ambiguous' | 'resolved';
  status: string | null;
};

// Prototype only. The production read still uses the existing retrieval path.
async function resolveWithFreshEvidence(
  db: PoolClient, owner: Owner, scope: Scope, keys: string[], previousId: string, barrier?: number,
) {
  const { rows: [result] } = await db.query<Evidence>(`
    WITH pause AS MATERIALIZED (
      SELECT pg_advisory_xact_lock_shared(20261127, $8) WHERE $8 IS NOT NULL
    ), allowed AS MATERIALIZED (
      SELECT (SELECT count(*) FROM pause) >= 0 AND app_private.is_ceo() AND EXISTS (
        SELECT FROM session WHERE id = $1 AND "userId" = $2 AND "expiresAt" > statement_timestamp()
      ) AS ok
    ), scope AS MATERIALIZED (
      SELECT EXISTS (
        SELECT FROM divisions WHERE id = $3 AND name = $6 AND code = $7 AND status = 'active'
      ) AS ok
    ), candidates AS MATERIALIZED (
      SELECT project.id, project.status
      FROM projects project CROSS JOIN allowed CROSS JOIN scope
      WHERE allowed.ok AND scope.ok AND project.division_id = $3 AND lower(project.name) = ANY($4::text[])
      LIMIT 2
    ), evidence AS (
      SELECT count(*) AS total, bool_or(id = $5) AS same_record, min(status::text) AS status FROM candidates
    )
    SELECT CASE
      WHEN NOT allowed.ok THEN 'unauthorized'
      WHEN NOT scope.ok THEN 'scope_changed'
      WHEN evidence.total = 0 THEN 'missing'
      WHEN evidence.total > 1 THEN 'ambiguous'
      WHEN NOT evidence.same_record THEN 'changed'
      ELSE 'resolved'
    END AS outcome,
    CASE WHEN allowed.ok AND evidence.total = 1 AND evidence.same_record THEN evidence.status END AS status
    FROM allowed CROSS JOIN scope CROSS JOIN evidence
  `, [owner.sessionId, owner.userId, scope.id, keys, previousId, scope.name, scope.code, barrier ?? null]);
  return result;
}

async function currentOwner(fixture: Awaited<ReturnType<typeof prepareAdminFixture>>) {
  const { rows: [owner] } = await fixture.db.query<Owner>(`
    SELECT user_profile.id AS "userId", session.id AS "sessionId"
    FROM "user" user_profile JOIN session ON session."userId" = user_profile.id
    WHERE user_profile.email = $1
    ORDER BY session."createdAt" DESC LIMIT 1
  `, [devCeoEmail]);
  expect(owner).toBeTruthy();
  return owner;
}

async function waitForAdvisoryLock(pool: Pool, pid: number) {
  await vi.waitFor(async () => {
    const { rows: [{ waiting }] } = await pool.query<{ waiting: boolean }>(
      "SELECT EXISTS (SELECT FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND NOT granted) AS waiting",
      [pid],
    );
    expect(waiting).toBe(true);
  }, { timeout: 3_000, interval: 20 });
}

test('cek ulang semua kandidat dan akses sebelum mengambil fakta proyek', async () => {
  const fixture = await prepareAdminFixture();
  const runtime = new Pool({ connectionString: fixture.config.DATABASE_URL, connectionTimeoutMillis: 5_000 });
  try {
    await fixture.login(devCeoEmail);
    const owner = await currentOwner(fixture);
    const { rows: [scope] } = await fixture.db.query<Scope>('SELECT id, name, code FROM divisions WHERE id = $1', [itDivision]);
    expect(scope).toBeTruthy();
    const originalTitle = 'Pembaruan Panel Dermaga';
    const alternativeTitle = 'Pembaruan Panel Dermaga Agustus';
    const keys = [originalTitle.toLowerCase(), alternativeTitle.toLowerCase()];
    const { rows: [original] } = await fixture.db.query<{ id: string }>(`
      INSERT INTO projects (division_id, name) VALUES ($1, $2) RETURNING id
    `, [itDivision, originalTitle]);
    const checkedEvidence = () => inTransaction(runtime, async (db) => {
      expect(await loadCeoIdentity(db, owner.userId, owner.sessionId)).toBeTruthy();
      return resolveWithFreshEvidence(db, owner, scope, keys, original.id);
    }, { readOnly: true });

    expect(await checkedEvidence()).toEqual({ outcome: 'resolved', status: 'pending' });
    await fixture.db.query('INSERT INTO projects (division_id, name) VALUES ($1, $2)', [financeDivision, alternativeTitle]);
    expect(await checkedEvidence()).toEqual({ outcome: 'resolved', status: 'pending' });

    const admin = await fixture.db.connect();
    const reader = await runtime.connect();
    let alternativeId: string;
    let pending: Promise<Evidence> | undefined;
    try {
      const { rows: [{ pid }] } = await reader.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      await admin.query('BEGIN');
      await admin.query('SELECT pg_advisory_xact_lock(20261127, 1)');
      await reader.query('BEGIN READ ONLY');
      expect(await loadCeoIdentity(reader, owner.userId, owner.sessionId)).toBeTruthy();
      pending = resolveWithFreshEvidence(reader, owner, scope, keys, original.id, 1);
      void pending.catch(() => undefined);
      await waitForAdvisoryLock(fixture.db, pid);
      const { rows: [{ id }] } = await admin.query<{ id: string }>(
        'INSERT INTO projects (division_id, name) VALUES ($1, $2) RETURNING id', [itDivision, alternativeTitle],
      );
      alternativeId = id;
      await admin.query('COMMIT');
      // The new contender became visible after the final statement's snapshot.
      expect(await pending).toEqual({ outcome: 'resolved', status: 'pending' });
    } finally {
      await admin.query('ROLLBACK');
      await pending?.catch(() => undefined);
      await reader.query('ROLLBACK');
      reader.release();
      admin.release();
    }
    expect(await checkedEvidence()).toEqual({ outcome: 'ambiguous', status: null });

    await fixture.db.query('UPDATE projects SET name = $1 WHERE id = $2', [originalTitle, alternativeId]);
    expect(await checkedEvidence()).toEqual({ outcome: 'ambiguous', status: null });

    await fixture.db.query('DELETE FROM projects WHERE id = $1', [original.id]);
    expect(await checkedEvidence()).toEqual({ outcome: 'changed', status: null });

    await fixture.db.query('UPDATE projects SET status = $1 WHERE id = $2', ['done', alternativeId]);
    const changed = await inTransaction(runtime, async (db) => {
      expect(await loadCeoIdentity(db, owner.userId, owner.sessionId)).toBeTruthy();
      return resolveWithFreshEvidence(db, owner, scope, keys, alternativeId);
    }, { readOnly: true });
    expect(changed).toEqual({ outcome: 'resolved', status: 'done' });

    await fixture.db.query('UPDATE divisions SET name = $1 WHERE id = $2', ['Operasi Dermaga', scope.id]);
    expect(await checkedEvidence()).toEqual({ outcome: 'scope_changed', status: null });
    await fixture.db.query('UPDATE divisions SET name = $1 WHERE id = $2', [scope.name, scope.id]);

    const signedOut = await inTransaction(runtime, async (db) => {
      expect(await loadCeoIdentity(db, owner.userId, owner.sessionId)).toBeTruthy();
      // Sign-out can commit without locking the matched work item.
      await fixture.db.query('DELETE FROM session WHERE id = $1', [owner.sessionId]);
      return resolveWithFreshEvidence(db, owner, scope, keys, alternativeId);
    }, { readOnly: true });
    expect(signedOut).toEqual({ outcome: 'unauthorized', status: null });

    await fixture.login(devCeoEmail);
    const fresh = await currentOwner(fixture);
    const revoker = await fixture.db.connect();
    const waitingReader = await runtime.connect();
    let awaitingAuthorization: ReturnType<typeof loadCeoIdentity> | undefined;
    try {
      const { rows: [{ pid }] } = await waitingReader.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      await revoker.query('BEGIN');
      await revoker.query('SELECT pg_advisory_xact_lock(20261126, 1)');
      await revoker.query("UPDATE account_access SET state = 'revoked' WHERE user_id = $1", [fresh.userId]);
      await waitingReader.query('BEGIN READ ONLY');
      awaitingAuthorization = loadCeoIdentity(waitingReader, fresh.userId, fresh.sessionId);
      void awaitingAuthorization.catch(() => undefined);
      await waitForAdvisoryLock(fixture.db, pid);
      await revoker.query('COMMIT');
      expect(await awaitingAuthorization).toBeNull();
    } finally {
      await revoker.query('ROLLBACK');
      await awaitingAuthorization?.catch(() => undefined);
      await waitingReader.query('ROLLBACK');
      waitingReader.release();
      revoker.release();
    }
  } finally {
    await runtime.end();
    await fixture.close();
  }
}, 45_000);
