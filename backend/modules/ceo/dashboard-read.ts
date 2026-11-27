import type { PoolClient } from 'pg';
import type { ReportPeriod } from '../admin/reports/report-period.js';
import { listAdminTasks } from '../admin/reports/task-report.js';
import { listCeoDivisions } from './division-read.js';
import type { StatusCounts } from './types.js';

export async function readCeoDashboard(db: PoolClient, period: ReportPeriod) {
  const divisions = await listCeoDivisions(db, period);
  const counts = { divisions: divisions.length, projects: 0, tasks: 0, members: 0 };
  const byStatus: StatusCounts = { pending: 0, on_progress: 0, done: 0 };
  for (const division of divisions) {
    counts.projects += division.projectCount;
    counts.tasks += division.taskCount;
    counts.members += division.memberCount;
    for (const status of ['pending', 'on_progress', 'done'] as const) {
      byStatus[status] += division.byStatus[status];
    }
  }
  const recentTasks = await listAdminTasks(db, period, { recent: true, limit: 8 });
  const latest = Math.max(...divisions.map(({ updatedAt }) => updatedAt.getTime()));
  return { counts, byStatus, divisions, recentTasks, updatedAt: Number.isFinite(latest) ? new Date(latest) : null };
}
