import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { ApiError, parseInput, resourceId } from '../../../http/api-error.js';
import type { RequireAdmin } from '../access.js';
import { revokeUser, updateAccount } from './account-mutations.js';
import { inviteUser, retryInvite, type InvitationDispatch } from './invitation-repository.js';
import type { SendInvitation } from './invitation-mailer.js';
import { listUsers, requireUser } from './repository.js';
import { createInvitation, editUser, userFilters, versionCheck } from './schema.js';

type UserPath = { Params: { id: string } };

export function registerUserAdminRoutes(app: FastifyInstance, requireAdmin: RequireAdmin) {
  app.get('/api/admin/users', (request) => requireAdmin(request, ({ db }) =>
    listUsers(db, parseInput(userFilters, request.query)),
  ));
  app.get<UserPath>('/api/admin/users/:id', (request) => requireAdmin(request, ({ db }) =>
    requireUser(db, request.params.id),
  ));
  app.patch<UserPath>('/api/admin/users/:id', (request) => requireAdmin(request, ({ db, actor }) =>
    updateAccount(db, actor.id, request.params.id, parseInput(editUser, request.body)), true,
  ));
  app.delete<UserPath>('/api/admin/users/:id', (request) => requireAdmin(request, ({ db, actor }) =>
    revokeUser(db, actor.id, request.params.id, parseInput(versionCheck, request.body ?? {}).version), true,
  ));
}

type MailService = { pool: Pool; origin: string; sendInvitation: SendInvitation };

export function registerInvitationRoutes(app: FastifyInstance, requireAdmin: RequireAdmin, mail: MailService) {
  async function deliver({ invite, token, hash }: InvitationDispatch) {
    const link = new URL('/activate', mail.origin);
    link.hash = new URLSearchParams({ token }).toString();
    try {
      await mail.sendInvitation({ email: invite.email, activationUrl: link.href });
      return invite;
    } catch {
      app.log.warn({ invitationId: invite.id }, 'Email undangan gagal dikirim');
      const { rows: [failed] } = await mail.pool.query<{ version: number; updatedAt: Date }>(`
        SELECT version, updated_at AS "updatedAt" FROM public.fail_invitation_delivery($1, $2)
      `, [invite.id, hash]);
      if (!failed) throw new ApiError(409, 'Undangan telah berubah. Muat ulang daftar pengguna.');
      return { ...invite, ...failed, status: 'failed' as const };
    }
  }

  app.post('/api/admin/invitations', async (request, reply) => {
    const dispatch = await requireAdmin(request, ({ db }) =>
      inviteUser(db, parseInput(createInvitation, request.body)),
    );
    return reply.code(201).send(await deliver(dispatch));
  });

  app.post<UserPath>('/api/admin/invitations/:id/retry', async (request) => {
    const dispatch = await requireAdmin(request, ({ db }) => retryInvite(
      db, resourceId(request.params.id), parseInput(versionCheck, request.body ?? {}).version,
    ));
    return deliver(dispatch);
  });
}
