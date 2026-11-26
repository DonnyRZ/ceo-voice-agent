import type { FastifyInstance } from 'fastify';
import { parseInput, resourceId } from '../../../http/api-error.js';
import type { RequireAdmin } from '../access.js';
import { archiveDivision, findDivision, insertDivision, listDivisionMembers, listDivisions, saveDivision } from './division-repository.js';
import { archiveVersion, divisionEdit, divisionFilters, divisionInput } from './division-schema.js';

type DivisionPath = { Params: { id: string } };

export function registerDivisionAdminRoutes(app: FastifyInstance, requireAdmin: RequireAdmin) {
  app.get('/api/admin/divisions', (request) => requireAdmin(request, ({ db }) =>
    listDivisions(db, parseInput(divisionFilters, request.query)),
  ));

  app.get<DivisionPath>('/api/admin/divisions/:id', (request) => requireAdmin(request, async ({ db }) => {
    const id = resourceId(request.params.id);
    const division = await findDivision(db, id);
    return { ...division, members: await listDivisionMembers(db, id) };
  }));

  app.post('/api/admin/divisions', async (request, reply) => {
    const division = await requireAdmin(request, ({ db }) => insertDivision(db, parseInput(divisionInput, request.body)));
    return reply.code(201).send(division);
  });

  app.patch<DivisionPath>('/api/admin/divisions/:id', (request) => requireAdmin(request, ({ db }) =>
    saveDivision(db, resourceId(request.params.id), parseInput(divisionEdit, request.body)),
  ));

  app.delete<DivisionPath>('/api/admin/divisions/:id', async (request, reply) => {
    const result = await requireAdmin(request, ({ db }) => {
      const id = resourceId(request.params.id);
      const { version } = parseInput(archiveVersion, request.body ?? request.query);
      return archiveDivision(db, id, version);
    });
    if (result.blocked) return reply.code(409).send(result.blocked);
    return result.division;
  });
}
