import type { PoolClient } from 'pg';
import { z } from 'zod';
import { ApiError } from '../../../http/api-error.js';
import type { Task } from '../../timesheets/task-repository.js';
import { workStatus } from '../../work-status.js';
import { periodFields, validPeriod } from './report-period.js';

export const reportTaskFilters = z.object({
  ...periodFields,
  divisionId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  picId: z.string().trim().min(1).max(128).optional(),
  status: workStatus.optional(),
  search: z.string().trim().max(120).optional(),
}).refine(validPeriod.check, validPeriod.error);

export type AdminTask = Task & { divisionId: string; divisionName: string };
type ReportTaskFilters = z.infer<typeof reportTaskFilters>;

const taskSelect = `
  SELECT t.id, to_char(t.date, 'YYYY-MM-DD') AS date, t.title, t.description,
    t.project_id AS "projectId", p.name AS "projectName", t.pic_id AS "picId", m.name AS "picName",
    d.id AS "divisionId", d.name AS "divisionName", t.status, t.version, t.updated_at AS "updatedAt"
  FROM tasks t
  JOIN divisions d ON d.id = t.division_id
  JOIN projects p ON p.id = t.project_id AND p.division_id = t.division_id
  JOIN members m ON m.id = t.pic_id AND m.division_id = t.division_id
`;

export async function listAdminTasks(db: PoolClient, filters: ReportTaskFilters) {
  const { rows } = await db.query<AdminTask>(`
    ${taskSelect}
    WHERE ($1::uuid IS NULL OR d.id = $1)
      AND ($2::date IS NULL OR t.date >= $2)
      AND ($3::date IS NULL OR t.date <= $3)
      AND ($4::uuid IS NULL OR t.project_id = $4)
      AND ($5::text IS NULL OR t.pic_id = $5)
      AND ($6::work_status IS NULL OR t.status = $6)
      AND ($7::text IS NULL OR strpos(lower(t.title), lower($7)) > 0 OR strpos(lower(t.description), lower($7)) > 0)
    ORDER BY t.date DESC, t.updated_at DESC, t.id
  `, [filters.divisionId, filters.from, filters.to, filters.projectId, filters.picId, filters.status, filters.search]);
  return rows;
}

export async function findAdminTask(db: PoolClient, id: string) {
  const { rows: [task] } = await db.query<AdminTask>(`${taskSelect} WHERE t.id = $1`, [id]);
  if (!task) throw new ApiError(404, 'Tugas tidak ditemukan.');
  return task;
}
