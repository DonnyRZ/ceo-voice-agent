import type { FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { ApiError } from '../../http/api-error.js';
import type { Member, RequireSession } from './session-access.js';

export type RequireMember = <T>(
  request: FastifyRequest,
  run: (scope: { db: PoolClient; member: Member }) => Promise<T>,
) => Promise<T>;

export function memberAccess(requireSession: RequireSession): RequireMember {
  return (request, run) => requireSession(request, ({ db, actor }) => {
    if (actor.role !== 'member') throw new ApiError(403, 'Akses ini khusus Anggota Divisi.');
    return run({ db, member: actor });
  });
}
