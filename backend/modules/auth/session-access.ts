import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { inTransaction } from '../../db/transaction.js';
import { ApiError } from '../../http/api-error.js';
import type { Auth } from './auth.js';

type Identity = { id: string; name: string; email: string };
export type Member = Identity & { role: 'member'; divisionId: string; divisionName: string };
export type Superadmin = Identity & { role: 'superadmin'; divisionId: null; divisionName: null };
export type Ceo = Identity & { role: 'ceo'; divisionId: null; divisionName: null };
export type SessionUser = Member | Superadmin | Ceo;

type SessionScope = { db: PoolClient; actor: SessionUser; sessionId: string };

export async function loadIdentity(
  db: PoolClient,
  userId: string,
  sessionId?: string,
  changeAuthority = false,
) {
  // Exclusive access changes cannot race an authenticated request using the old role.
  const lock = changeAuthority ? 'pg_advisory_xact_lock' : 'pg_advisory_xact_lock_shared';
  await db.query(`
    SELECT pg_catalog.${lock}(20261126, 1), set_config('app.user_id', $1, true)
  `, [userId]);
  const { rows: [actor] } = await db.query<SessionUser>(`
    SELECT account.user_id AS id, profile.name, profile.email, account.role,
           account.division_id AS "divisionId", division.name AS "divisionName"
    FROM account_access account
    JOIN "user" profile ON profile.id = account.user_id
    LEFT JOIN divisions division ON division.id = account.division_id
    WHERE account.user_id = $1 AND account.state = 'active' AND account.registration_complete
      AND (account.role IN ('superadmin', 'ceo') OR division.status = 'active')
      AND ($2::text IS NULL OR EXISTS (
        SELECT 1 FROM session
        WHERE id = $2 AND "userId" = $1 AND "expiresAt" > now()
      ))
  `, [userId, sessionId ?? null]);
  return actor;
}

export type RequireSession = <T>(
  request: FastifyRequest,
  run: (scope: SessionScope) => Promise<T>,
  changeAuthority?: boolean,
  options?: { readOnly?: boolean },
) => Promise<T>;

export function sessionAccess(pool: Pool, auth: Auth): RequireSession {
  return async (request, run, changeAuthority, options) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) throw new ApiError(401, 'Masuk untuk melanjutkan.');

    return inTransaction(pool, async (db) => {
      const actor = await loadIdentity(db, session.user.id, session.session.id, changeAuthority);
      if (!actor) throw new ApiError(401, 'Akses akun tidak aktif.');
      if (actor.role === 'member') {
        await db.query("SELECT set_config('app.division_id', $1, true)", [actor.divisionId]);
      }
      return run({ db, actor, sessionId: session.session.id });
    }, options);
  };
}
