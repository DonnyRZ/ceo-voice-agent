import type { FastifyInstance } from 'fastify';
import { parseInput, resourceId } from '../../../http/api-error.js';
import { taskHistory } from '../../timesheets/task-repository.js';
import type { RequireAdmin } from '../access.js';
import { dashboardReport } from './dashboard-report.js';
import { reportPeriod } from './report-period.js';
import { findAdminTask, listAdminTasks, reportTaskFilters } from './task-report.js';

type TaskPath = { Params: { id: string } };

export function registerReportAdminRoutes(app: FastifyInstance, requireAdmin: RequireAdmin) {
  app.get('/api/admin/dashboard', (request) => requireAdmin(request, ({ db }) =>
    dashboardReport(db, parseInput(reportPeriod, request.query)),
  ));

  app.get('/api/admin/tasks', (request) => requireAdmin(request, ({ db }) =>
    listAdminTasks(db, parseInput(reportTaskFilters, request.query)),
  ));

  app.get<TaskPath>('/api/admin/tasks/:id', (request) => requireAdmin(request, ({ db }) =>
    findAdminTask(db, resourceId(request.params.id)),
  ));

  app.get<TaskPath>('/api/admin/tasks/:id/history', (request) => requireAdmin(request, async ({ db }) => {
    const task = await findAdminTask(db, resourceId(request.params.id));
    return taskHistory(db, task.id);
  }));
}
