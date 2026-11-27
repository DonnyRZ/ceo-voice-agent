import { readHistory } from './history-sql.js';
import type { CeoRequest } from './request-types.js';
import { ceoFactSchema, type CeoEntity, type CeoFacts, type RetrievalDatabase } from './schema.js';
import { readSnapshot, readTasks, timestamp } from './task-sql.js';

async function latestProject(db: RetrievalDatabase, request: CeoRequest) {
  if (request.asOf) {
    const { rows: [project] } = await db.query<CeoEntity>(`
      SELECT 'project' AS kind, work.id::text, snapshot.title AS name, division.name AS "divisionName"
      FROM public.projects AS work
      JOIN LATERAL public.ceo_work_status_as_of('project', work.id, $2::timestamptz) AS snapshot ON true
      JOIN public.divisions AS division ON division.id = snapshot.division_id
      WHERE ($1::uuid IS NULL OR division.id = $1)
      ORDER BY snapshot.changed_at DESC, work.id LIMIT 1`, [request.division?.id ?? null, request.asOf]);
    return project;
  }
  const { rows: [project] } = await db.query<CeoEntity>(`
    SELECT 'project' AS kind, project.id::text, project.name, division.name AS "divisionName"
    FROM public.projects AS project
    JOIN public.divisions AS division ON division.id = project.division_id
    WHERE ($1::uuid IS NULL OR division.id = $1)
    ORDER BY project.updated_at DESC, project.id
    LIMIT 1`, [request.division?.id ?? null]);
  return project;
}

export async function readFacts(db: RetrievalDatabase, request: CeoRequest): Promise<CeoFacts | undefined> {
  const base = {
    intent: request.intent,
    entity: request.entity ?? (request.division && { kind: 'division' as const, id: request.division.id, name: request.division.name }),
    period: request.period,
    asOf: request.asOf,
    focusUpdatedAt: request.focusUpdatedAt,
    tasks: [],
    history: [],
  };
  if (request.intent === 'summary') {
    const rows = await readTasks(db, request, 8);
    return ceoFactSchema.parse({ ...base, ...rows, statusFilter: request.statuses });
  }
  if (request.intent === 'history') {
    const history = await readHistory(db, request);
    return history.length ? ceoFactSchema.parse({ ...base, history }) : undefined;
  }
  if (!request.entity && request.latest && request.entityKind === 'task') {
    const { tasks } = await readTasks(db, request, 1);
    const [task] = tasks;
    if (!task) return;
    const entity = { kind: 'task' as const, id: task.id, name: task.title, divisionName: task.divisionName };
    return ceoFactSchema.parse({ ...base, entity, tasks, status: task.status, updatedAt: task.updatedAt, picName: task.picName });
  }
  if (!request.entity && request.latest && request.entityKind === 'project' && !request.period) {
    const project = await latestProject(db, request);
    if (project) return readFacts(db, { ...request, entity: project });
  }
  if (!request.entity || request.entity.kind === 'division') return;
  if (request.entity.kind === 'task' && !request.asOf) {
    const { tasks } = await readTasks(db, request, 1);
    const [task] = tasks;
    if (!task) return;
    const entity = { kind: 'task' as const, id: task.id, name: task.title, divisionName: task.divisionName };
    return ceoFactSchema.parse({ ...base, entity, tasks, status: task.status, updatedAt: task.updatedAt, picName: task.picName });
  }

  const snapshot = await readSnapshot(db, request);
  if (!snapshot) return;
  const entity = { ...request.entity, name: snapshot.name, divisionName: snapshot.divisionName };
  const status = { status: snapshot.status, updatedAt: timestamp(snapshot.updatedAt), evidenceId: snapshot.evidenceId ?? undefined };
  if (entity.kind === 'task') {
    const { tasks } = await readTasks(db, { ...request, entity }, 1);
    return ceoFactSchema.parse({ ...base, entity, ...status, picName: snapshot.picName, tasks });
  }
  if (request.intent === 'status' && (request.asOf || request.focusUpdatedAt)) {
    return ceoFactSchema.parse({ ...base, entity, ...status });
  }
  const { tasks, counts } = await readTasks(db, { ...request, entity }, request.intent === 'pic' ? 8 : 5);
  return ceoFactSchema.parse({ ...base, entity, ...status, tasks, counts });
}
