import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { ApiError, parseInput } from '../../../http/api-error.js';
import { hashInvitationToken } from './invitation-repository.js';
import { activation } from './schema.js';

function invalidInvitation() {
  return new ApiError(400, 'Tautan aktivasi tidak berlaku. Hubungi Superadmin untuk undangan baru.');
}

export function registerActivationRoute(app: FastifyInstance, pool: Pool) {
  app.post('/api/activate', async (request, reply) => {
    const input = parseInput(activation, request.body);
    const tokenHash = hashInvitationToken(input.token);
    const { rows: [availability] } = await pool.query<{ open: boolean }>(
      'SELECT public.invitation_is_open($1) AS open', [tokenHash],
    );
    if (!availability.open) throw invalidInvitation();

    const credentialHash = await hashPassword(input.password);
    const { rows: [completed] } = await pool.query<{ email: string | null }>(`
      SELECT public.complete_invitation($1, $2, $3, $4, $5) AS email
    `, [tokenHash, randomUUID(), randomUUID(), input.name, credentialHash]);
    if (!completed.email) throw invalidInvitation();
    return reply.code(201).send({ email: completed.email });
  });
}
