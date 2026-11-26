import type { PoolClient } from 'pg';
import { ApiError } from '../../../http/api-error.js';
import { auditTables, type AuditAction, type AuditEntity, type AuditFilters } from './audit-schema.js';

export type AdminAudit = {
  id: string;
  action: AuditAction;
  entity: AuditEntity;
  recordId: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  divisionId: string | null;
  divisionName: string | null;
  changedAt: Date;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

const auditSelect = `
  SELECT a.id::text, a.action, a.record_id AS "recordId", a.actor_id AS "actorId",
    a.actor_name AS "actorName", a.actor_email AS "actorEmail", a.division_id AS "divisionId",
    d.name AS "divisionName", a.changed_at AS "changedAt",
    a.old_row - 'token_hash' AS "before", a.new_row - 'token_hash' AS "after",
    CASE a.record_table
      WHEN 'tasks' THEN 'task' WHEN 'projects' THEN 'project' WHEN 'divisions' THEN 'division'
      WHEN 'members' THEN 'member' WHEN 'account_access' THEN 'access' WHEN 'invitations' THEN 'invitation'
    END AS entity
  FROM audit_log a
  LEFT JOIN divisions d ON d.id = a.division_id
`;

export async function listAudit(db: PoolClient, filters: AuditFilters, limit?: number) {
  const { rows } = await db.query<AdminAudit>(`
    ${auditSelect}
    WHERE a.record_table = ANY($1::text[])
      AND ($2::text IS NULL OR a.record_table = $2)
      AND ($3::text IS NULL OR a.action = $3)
      AND ($4::text IS NULL OR a.actor_id = $4
        OR strpos(lower(coalesce(a.actor_name, '')), lower($4)) > 0
        OR strpos(lower(coalesce(a.actor_email, '')), lower($4)) > 0)
      AND ($5::uuid IS NULL OR a.division_id = $5)
      AND ($6::date IS NULL OR a.changed_at >= ($6::date::timestamp AT TIME ZONE 'Asia/Jakarta'))
      AND ($7::date IS NULL OR a.changed_at < (($7::date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta'))
    ORDER BY a.changed_at DESC, a.id DESC
    LIMIT $8
  `, [Object.values(auditTables), filters.entity && auditTables[filters.entity], filters.action,
    filters.actor, filters.divisionId, filters.from, filters.to, limit]);
  return rows;
}

export async function findAudit(db: PoolClient, id: string) {
  const { rows: [event] } = await db.query<AdminAudit>(`
    ${auditSelect} WHERE a.id = $1 AND a.record_table = ANY($2::text[])
  `, [id, Object.values(auditTables)]);
  if (!event) throw new ApiError(404, 'Perubahan tidak ditemukan.');
  return event;
}
