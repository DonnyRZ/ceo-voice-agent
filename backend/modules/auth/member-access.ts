import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { ApiError } from '../../http/api-error.js';
import type { Auth } from './auth.js';

export type Member = {
  id: string;
  name: string;
  email: string;
  divisionId: string;
  divisionName: string;
};

type MemberScope = {
  db: PoolClient;
  member: Member;
};

export type RequireMember = <Result>(
  request: FastifyRequest,
  run: (scope: MemberScope) => Promise<Result>,
) => Promise<Result>;

export function memberAccess(pool: Pool, auth: Auth): RequireMember {
  return async (request, run) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) throw new ApiError(401, 'Masuk untuk melanjutkan.');

    const db = await pool.connect();
    let releaseError: Error | undefined;
    try {
      await db.query('BEGIN');
      await db.query("SELECT set_config('app.user_id', $1, true)", [session.user.id]);
      const { rows: [record] } = await db.query<Omit<Member, 'email'>>(`
        SELECT m.id, m.name, m.division_id AS "divisionId", d.name AS "divisionName"
        FROM members m
        JOIN divisions d ON d.id = m.division_id
        WHERE m.id = $1
      `, [session.user.id]);
      if (!record) throw new ApiError(403, 'Akun Anda belum terhubung ke divisi.');

      await db.query("SELECT set_config('app.division_id', $1, true)", [record.divisionId]);
      const result = await run({ db, member: { ...record, email: session.user.email } });
      await db.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await db.query('ROLLBACK');
      } catch (rollbackError) {
        releaseError = rollbackError instanceof Error ? rollbackError : new Error('Rollback gagal.');
      }
      throw error;
    } finally {
      db.release(releaseError);
    }
  };
}
