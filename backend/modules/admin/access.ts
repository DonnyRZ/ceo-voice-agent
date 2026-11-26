import type { FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { ApiError } from '../../http/api-error.js';
import type { RequireSession, Superadmin } from '../auth/session-access.js';

export type RequireAdmin = <T>(
  request: FastifyRequest,
  run: (scope: { db: PoolClient; actor: Superadmin }) => Promise<T>,
  changeAuthority?: boolean,
) => Promise<T>;

export function adminAccess(requireSession: RequireSession): RequireAdmin {
  return (request, run, changeAuthority) => requireSession(request, ({ db, actor }) => {
    if (actor.role !== 'superadmin') throw new ApiError(403, 'Akses ini khusus Superadmin.');
    return run({ db, actor });
  }, changeAuthority);
}
