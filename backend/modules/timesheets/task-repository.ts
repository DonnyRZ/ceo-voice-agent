import type { PoolClient } from 'pg';
import { ApiError } from '../../http/api-error.js';
import type { WorkStatus } from '../work-status.js';
import type { TaskEdit, TaskFilters, TaskInput } from './task-schema.js';

export type Task = TaskInput & {
  id: string;
  projectName: string;
  picName: string;
  version: number;
  updatedAt: Date;
};

type TaskStatusEvent = {
  id: string;
  changedAt: Date;
  previousStatus: WorkStatus;
  status: WorkStatus;
  actorName: string | null;
};

const taskSelect = `
  SELECT t.id, to_char(t.date, 'YYYY-MM-DD') AS date, t.title, t.description, t.project_id AS "projectId",
         p.name AS "projectName", t.pic_id AS "picId", m.name AS "picName",
         t.status, t.version, t.updated_at AS "updatedAt"
  FROM tasks t
  JOIN projects p ON p.id = t.project_id AND p.division_id = t.division_id
  JOIN members m ON m.id = t.pic_id AND m.division_id = t.division_id
`;

export async function listTasks(db: PoolClient, divisionId: string, filters: TaskFilters) {
  const { rows } = await db.query<Task>(`
    ${taskSelect}
    WHERE t.division_id = $1
      AND ($2::date IS NULL OR t.date >= $2)
      AND ($3::date IS NULL OR t.date <= $3)
      AND ($4::uuid IS NULL OR t.project_id = $4)
      AND ($5::text IS NULL OR t.pic_id = $5)
      AND ($6::work_status IS NULL OR t.status = $6)
    ORDER BY t.date DESC, t.updated_at DESC, t.id
  `, [divisionId, filters.from, filters.to, filters.projectId, filters.picId, filters.status]);
  return rows;
}

export async function findTask(db: PoolClient, divisionId: string, id: string) {
  const { rows: [task] } = await db.query<Task>(`
    ${taskSelect}
    WHERE t.division_id = $1 AND t.id = $2
  `, [divisionId, id]);
  return task;
}

export async function taskHistory(db: PoolClient, id: string) {
  const { rows } = await db.query<TaskStatusEvent>(`
    SELECT id, changed_at AS "changedAt", previous_status AS "previousStatus",
           status, actor_name AS "actorName"
    FROM task_status_history($1)
    ORDER BY changed_at DESC, id::bigint DESC
  `, [id]);
  return rows;
}

async function validateAssignment(
  db: PoolClient,
  divisionId: string,
  { projectId, picId }: Pick<TaskInput, 'projectId' | 'picId'>,
) {
  const { rows: [assignment] } = await db.query<{ project: boolean; pic: boolean }>(`
    SELECT
      EXISTS (SELECT 1 FROM projects WHERE division_id = $1 AND id = $2) AS project,
      EXISTS (SELECT 1 FROM members WHERE division_id = $1 AND id = $3) AS pic
  `, [divisionId, projectId, picId]);

  const fields: Record<string, string> = {};
  if (!assignment.project) fields.projectId = 'Pilih proyek yang tersedia di divisi Anda.';
  if (!assignment.pic) fields.picId = 'Pilih PIC dari divisi Anda.';
  if (Object.keys(fields).length > 0) throw new ApiError(400, 'Periksa kembali isian Anda.', fields);
}

export async function insertTask(db: PoolClient, divisionId: string, input: TaskInput) {
  await validateAssignment(db, divisionId, input);
  const { rows: [task] } = await db.query<{ id: string }>(`
    INSERT INTO tasks (division_id, date, title, description, project_id, pic_id, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `, [divisionId, input.date, input.title, input.description, input.projectId, input.picId, input.status]);
  return findTask(db, divisionId, task.id);
}

export async function updateTask(
  db: PoolClient,
  divisionId: string,
  id: string,
  input: TaskEdit,
) {
  await validateAssignment(db, divisionId, input);
  const updated = await db.query(`
    UPDATE tasks
    SET date = $3, title = $4, description = COALESCE($5, description), project_id = $6, pic_id = $7,
        status = $8, version = version + 1, updated_at = now()
    WHERE division_id = $1 AND id = $2 AND version = $9
  `, [divisionId, id, input.date, input.title, input.description ?? null, input.projectId, input.picId, input.status, input.version]);
  if (updated.rowCount === 0) return undefined;
  return findTask(db, divisionId, id);
}
