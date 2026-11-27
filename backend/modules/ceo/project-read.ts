import type { PoolClient } from 'pg';
import { ApiError } from '../../http/api-error.js';
import type { ReportPeriod } from '../admin/reports/report-period.js';
import type { CeoProject } from './types.js';

export async function listCeoProjects(db: PoolClient, period: ReportPeriod, divisionId?: string, id?: string) {
  const { rows } = await db.query<CeoProject>(`
    SELECT p.id, p.name, p.description, p.status, p.version, p.updated_at AS "updatedAt",
      d.id AS "divisionId", d.name AS "divisionName", totals.total AS "taskCount",
      jsonb_build_object('pending', totals.pending, 'on_progress', totals.on_progress,
        'done', totals.done) AS "byStatus",
      coalesce(round(100.0 * totals.done / nullif(totals.total, 0)), 0)::int AS progress,
      coalesce(totals.names, ARRAY[]::text[]) AS "picNames"
    FROM projects p JOIN divisions d ON d.id = p.division_id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE t.status = 'pending')::int AS pending,
        count(*) FILTER (WHERE t.status = 'on_progress')::int AS on_progress,
        count(*) FILTER (WHERE t.status = 'done')::int AS done,
        array_agg(DISTINCT m.name ORDER BY m.name) AS names
      FROM tasks t JOIN members m ON m.division_id = t.division_id AND m.id = t.pic_id
      WHERE t.project_id = p.id AND t.division_id = p.division_id
        AND ($1::date IS NULL OR t.date >= $1) AND ($2::date IS NULL OR t.date <= $2)
    ) AS totals ON true
    WHERE ($3::uuid IS NULL OR p.division_id = $3) AND ($4::uuid IS NULL OR p.id = $4)
    ORDER BY p.name, p.id
  `, [period.from, period.to, divisionId, id]);
  return rows;
}

export async function findCeoProject(db: PoolClient, id: string, period: ReportPeriod) {
  const [project] = await listCeoProjects(db, period, undefined, id);
  if (!project) throw new ApiError(404, 'Proyek tidak ditemukan.');
  return project;
}
