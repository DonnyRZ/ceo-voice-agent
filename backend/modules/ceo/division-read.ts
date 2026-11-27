import type { PoolClient } from 'pg';
import { ApiError } from '../../http/api-error.js';
import type { CeoDivisionFilters } from './schema.js';
import type { CeoDivision } from './types.js';

export async function listCeoDivisions(db: PoolClient, filters: CeoDivisionFilters, id?: string) {
  const { rows } = await db.query<CeoDivision>(`
    WITH task_totals AS (
      SELECT division_id, count(*)::int AS total, max(updated_at) AS updated_at,
        count(*) FILTER (WHERE status = 'pending')::int AS pending,
        count(*) FILTER (WHERE status = 'on_progress')::int AS on_progress,
        count(*) FILTER (WHERE status = 'done')::int AS done
      FROM tasks
      WHERE ($1::date IS NULL OR date >= $1) AND ($2::date IS NULL OR date <= $2)
        AND ($5::uuid IS NULL OR division_id = $5)
      GROUP BY division_id
    ), project_totals AS (
      SELECT division_id, count(*)::int AS total, max(updated_at) AS updated_at
      FROM projects WHERE ($5::uuid IS NULL OR division_id = $5) GROUP BY division_id
    ), member_totals AS (
      SELECT division_id, count(*)::int AS total FROM members
      WHERE ($5::uuid IS NULL OR division_id = $5) AND app_private.is_active_member(division_id, id)
      GROUP BY division_id
    )
    SELECT d.id, d.name, d.code, d.description, d.status,
      greatest(d.updated_at, t.updated_at, p.updated_at) AS "updatedAt",
      coalesce(m.total, 0) AS "memberCount", coalesce(p.total, 0) AS "projectCount",
      coalesce(t.total, 0) AS "taskCount", jsonb_build_object(
        'pending', coalesce(t.pending, 0), 'on_progress', coalesce(t.on_progress, 0),
        'done', coalesce(t.done, 0)) AS "byStatus",
      coalesce(round(100.0 * t.done / nullif(t.total, 0)), 0)::int AS progress
    FROM divisions d
    LEFT JOIN task_totals t ON t.division_id = d.id
    LEFT JOIN project_totals p ON p.division_id = d.id
    LEFT JOIN member_totals m ON m.division_id = d.id
    WHERE ($3::text IS NULL OR strpos(lower(d.name), lower($3)) > 0
      OR strpos(lower(d.code), lower($3)) > 0 OR strpos(lower(d.description), lower($3)) > 0)
      AND ($4::text IS NULL OR d.status = $4) AND ($5::uuid IS NULL OR d.id = $5)
    ORDER BY d.name, d.id
  `, [filters.from, filters.to, filters.search, filters.status, id]);
  return rows;
}

export async function findCeoDivision(db: PoolClient, id: string, filters: CeoDivisionFilters) {
  const [division] = await listCeoDivisions(db, filters, id);
  if (!division) throw new ApiError(404, 'Divisi tidak ditemukan.');
  return division;
}

export async function listCeoMembers(db: PoolClient, divisionId: string) {
  const { rows } = await db.query<{ id: string; name: string }>(`
    SELECT id, name FROM members
    WHERE division_id = $1 AND app_private.is_active_member(division_id, id)
    ORDER BY name, id
  `, [divisionId]);
  return rows;
}
