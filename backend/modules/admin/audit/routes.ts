import type { FastifyInstance } from 'fastify';
import { parseInput } from '../../../http/api-error.js';
import type { RequireAdmin } from '../access.js';
import { findAudit, listAudit } from './audit-repository.js';
import { auditFilters, auditId } from './audit-schema.js';

export function registerAuditAdminRoutes(app: FastifyInstance, requireAdmin: RequireAdmin) {
  app.get('/api/admin/audit', (request) => requireAdmin(request, ({ db }) =>
    listAudit(db, parseInput(auditFilters, request.query)),
  ));

  app.get<{ Params: { id: string } }>('/api/admin/audit/:id', (request) => requireAdmin(request, ({ db }) =>
    findAudit(db, auditId(request.params.id)),
  ));
}
