import type { FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { ApiError } from '../../http/api-error.js';
import { loadIdentity, type Ceo, type RequireSession } from './session-access.js';

export type RequireCeo = <T>(
  request: FastifyRequest,
  run: (scope: { db: PoolClient; actor: Ceo; sessionId: string }) => Promise<T>,
) => Promise<T>;

export function ceoAccess(requireSession: RequireSession): RequireCeo {
  return (request, run) => requireSession(request, ({ db, actor, sessionId }) => {
    if (actor.role !== 'ceo') throw new ApiError(403, 'Akses ini khusus CEO.');
    return run({ db, actor, sessionId });
  }, false, { readOnly: true });
}

export async function loadCeoIdentity(db: PoolClient, userId: string, sessionId: string) {
  const actor = await loadIdentity(db, userId, sessionId);
  return actor?.role === 'ceo' ? actor : null;
}
