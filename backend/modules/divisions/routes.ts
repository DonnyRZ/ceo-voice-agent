import type { FastifyInstance } from 'fastify';
import type { RequireMember } from '../auth/member-access.js';

export function registerDivisionRoutes(app: FastifyInstance, requireMember: RequireMember) {
  app.get('/api/session', (request) =>
    requireMember(request, async ({ member }) => ({ user: member })),
  );

  app.get('/api/members', (request) =>
    requireMember(request, async ({ db, member }) => {
      const { rows } = await db.query<{ id: string; name: string }>(`
        SELECT id, name FROM members
        WHERE division_id = $1
        ORDER BY name, id
      `, [member.divisionId]);
      return rows;
    }),
  );
}
