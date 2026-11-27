import type { FastifyInstance } from 'fastify';
import { parseInput, resourceId } from '../../http/api-error.js';
import { reportPeriod } from '../admin/reports/report-period.js';
import { findAdminTask, listAdminTasks, reportTaskFilters } from '../admin/reports/task-report.js';
import type { RequireCeo } from '../auth/ceo-access.js';
import { readCeoDashboard } from './dashboard-read.js';
import { findCeoDivision, listCeoDivisions, listCeoMembers } from './division-read.js';
import { findCeoProject, listCeoProjects } from './project-read.js';
import { ceoDivisionFilters } from './schema.js';

type ResourcePath = { Params: { id: string } };

export function registerCeoRoutes(app: FastifyInstance, requireCeo: RequireCeo) {
  app.get('/api/ceo/dashboard', (request) => requireCeo(request, ({ db }) =>
    readCeoDashboard(db, parseInput(reportPeriod, request.query)),
  ));

  app.get('/api/ceo/divisions', (request) => requireCeo(request, ({ db }) =>
    listCeoDivisions(db, parseInput(ceoDivisionFilters, request.query)),
  ));

  app.get<ResourcePath>('/api/ceo/divisions/:id', (request) => requireCeo(request, async ({ db }) => {
    const id = resourceId(request.params.id);
    const period = parseInput(reportPeriod, request.query);
    const division = await findCeoDivision(db, id, period);
    const members = await listCeoMembers(db, id);
    const projects = await listCeoProjects(db, period, id);
    const tasks = await listAdminTasks(db, { ...period, divisionId: id });
    return { ...division, members, projects, tasks };
  }));

  app.get<ResourcePath>('/api/ceo/projects/:id', (request) => requireCeo(request, async ({ db }) => {
    const id = resourceId(request.params.id);
    const period = parseInput(reportPeriod, request.query);
    const project = await findCeoProject(db, id, period);
    return { ...project, tasks: await listAdminTasks(db, { ...period, projectId: id }) };
  }));

  app.get('/api/ceo/tasks', (request) => requireCeo(request, ({ db }) =>
    listAdminTasks(db, parseInput(reportTaskFilters, request.query)),
  ));

  app.get<ResourcePath>('/api/ceo/tasks/:id', (request) => requireCeo(request, ({ db }) =>
    findAdminTask(db, resourceId(request.params.id)),
  ));

  app.get<ResourcePath>('/api/ceo/tasks/:id/history', (request) => requireCeo(request, async ({ db }) => {
    const task = await findAdminTask(db, resourceId(request.params.id));
    const { rows } = await db.query(`
      SELECT id, changed_at AS "changedAt", previous_status AS "previousStatus",
        status, actor_name AS "actorName"
      FROM ceo_work_status_history('task', $1, NULL, NULL, 50)
    `, [task.id]);
    return rows;
  }));
}
