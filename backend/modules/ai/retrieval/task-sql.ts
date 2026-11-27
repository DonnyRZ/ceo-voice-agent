import type { WorkStatus } from '../../work-status.js';
import type { CeoRequest } from './request-types.js';
import type { CeoTaskFact, CountFact, RetrievalDatabase } from './schema.js';

const currentTasks = `
    SELECT task.id::text, task.title, task.project_id::text AS "projectId", project.name AS "projectName",
      division.id::text AS "divisionId", division.name AS "divisionName", to_char(task.date, 'YYYY-MM-DD') AS date,
      task.status, member.name AS "picName", task.updated_at AS "updatedAt"
    FROM public.tasks AS task
    JOIN public.divisions AS division ON division.id = task.division_id
    JOIN public.projects AS project ON project.id = task.project_id AND project.division_id = division.id
    LEFT JOIN public.members AS member ON member.id = task.pic_id AND member.division_id = division.id
    WHERE ($1::uuid IS NULL OR division.id = $1)
      AND ($2::uuid IS NULL OR task.project_id = $2)
      AND ($3::uuid IS NULL OR task.id = $3)
      AND ($4::date IS NULL OR task.date >= $4)
      AND ($5::date IS NULL OR task.date <= $5)
      AND ($6::work_status[] IS NULL OR task.status = ANY($6))
      AND $7::timestamptz IS NULL`;

const historicalTasks = `
    SELECT task.id::text, snapshot.title, snapshot.project_id::text AS "projectId", project_snapshot.title AS "projectName",
      division.id::text AS "divisionId", division.name AS "divisionName", to_char(snapshot.task_date, 'YYYY-MM-DD') AS date,
      snapshot.status, snapshot.pic_name AS "picName", snapshot.changed_at AS "updatedAt"
    FROM public.tasks AS task
    JOIN LATERAL public.ceo_work_status_as_of('task', task.id, $7) AS snapshot ON true
    JOIN public.divisions AS division ON division.id = snapshot.division_id
    JOIN LATERAL public.ceo_work_status_as_of('project', snapshot.project_id, $7) AS project_snapshot ON true
    WHERE ($1::uuid IS NULL OR division.id = $1)
      AND ($2::uuid IS NULL OR snapshot.project_id = $2)
      AND ($3::uuid IS NULL OR task.id = $3)
      AND ($4::date IS NULL OR snapshot.task_date >= $4)
      AND ($5::date IS NULL OR snapshot.task_date <= $5)
      AND ($6::work_status[] IS NULL OR snapshot.status = ANY($6))`;

type TaskAggregates = { counts: CountFact; tasks: CeoTaskFact[] };

export async function readTasks(db: RetrievalDatabase, request: CeoRequest, limit: number): Promise<TaskAggregates> {
  const divisionId = request.division?.id ?? (request.entity?.kind === 'division' ? request.entity.id : null);
  const projectId = request.entity?.kind === 'project' ? request.entity.id : null;
  const taskId = request.entity?.kind === 'task' ? request.entity.id : null;
  const { rows: [result] } = await db.query<TaskAggregates>(`
    WITH selected AS MATERIALIZED (${request.asOf ? historicalTasks : currentTasks})
    SELECT (SELECT json_build_object(
        'pending', count(*) FILTER (WHERE status = 'pending')::int,
        'on_progress', count(*) FILTER (WHERE status = 'on_progress')::int,
        'done', count(*) FILTER (WHERE status = 'done')::int,
        'total', count(*)::int
      ) FROM selected) AS counts,
      (SELECT coalesce(json_agg(sample), '[]'::json) FROM (
        SELECT * FROM selected ORDER BY date DESC, "updatedAt" DESC, id LIMIT $8
      ) AS sample) AS tasks`, [
    divisionId, projectId, taskId, request.period?.from ?? null, request.period?.to ?? null,
    request.statuses ?? null, request.asOf ?? null, Math.min(12, Math.max(0, limit)),
  ]);
  return {
    counts: result.counts,
    tasks: result.tasks.map((task) => ({ ...task, updatedAt: timestamp(task.updatedAt) })),
  };
}

export function timestamp(value: string | Date) {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export interface StatusSnapshot {
  status: WorkStatus;
  name: string;
  divisionName: string;
  updatedAt: Date;
  evidenceId: string | null;
  picName: string | null;
  date: string | null;
}

export async function readSnapshot(db: RetrievalDatabase, request: CeoRequest) {
  const entity = request.entity;
  if (!entity || entity.kind === 'division') return;
  if (request.asOf) {
    const { rows: [snapshot] } = await db.query<StatusSnapshot>(`
      SELECT snapshot.status, snapshot.title AS name, division.name AS "divisionName",
        snapshot.changed_at AS "updatedAt", snapshot.evidence_id AS "evidenceId", snapshot.pic_name AS "picName",
        to_char(snapshot.task_date, 'YYYY-MM-DD') AS date
      FROM public.ceo_work_status_as_of($1, $2::uuid, $3::timestamptz) AS snapshot
      JOIN public.divisions AS division ON division.id = snapshot.division_id
      WHERE ($4::uuid IS NULL OR division.id = $4)
        AND ($5::date IS NULL OR snapshot.task_date >= $5)
        AND ($6::date IS NULL OR snapshot.task_date <= $6)
      `, [entity.kind, entity.id, request.asOf, request.division?.id ?? null,
      entity.kind === 'task' ? request.period?.from ?? null : null, entity.kind === 'task' ? request.period?.to ?? null : null]);
    return snapshot;
  }
  const table = entity.kind === 'task' ? 'tasks' : 'projects';
  const fields = entity.kind === 'task'
    ? 'work.title AS name, member.name AS "picName", to_char(work.date, \'YYYY-MM-DD\') AS date'
    : 'work.name, null::text AS "picName", null::text AS date';
  const member = entity.kind === 'task' ? 'LEFT JOIN public.members AS member ON member.id = work.pic_id AND member.division_id = division.id' : '';
  const period = entity.kind === 'task' ? 'AND ($3::date IS NULL OR work.date >= $3) AND ($4::date IS NULL OR work.date <= $4)' : '';
  const parameters: unknown[] = [entity.id, request.division?.id ?? null];
  if (entity.kind === 'task') parameters.push(request.period?.from ?? null, request.period?.to ?? null);
  const { rows: [snapshot] } = await db.query<StatusSnapshot>(`
    SELECT work.status, ${fields}, division.name AS "divisionName", work.updated_at AS "updatedAt", null::text AS "evidenceId"
    FROM public.${table} AS work
    JOIN public.divisions AS division ON division.id = work.division_id
    ${member}
    WHERE work.id = $1::uuid AND ($2::uuid IS NULL OR division.id = $2) ${period}`, parameters);
  return snapshot;
}
