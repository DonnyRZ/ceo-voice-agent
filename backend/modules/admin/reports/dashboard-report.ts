import type { PoolClient } from 'pg';
import type { WorkStatus } from '../../work-status.js';
import { listAudit } from '../audit/audit-repository.js';
import type { ReportPeriod } from './report-period.js';

type DashboardCounts = {
  counts: { divisions: number; users: number; tasks: number; audit: number };
  byStatus: Record<WorkStatus, number>;
};

export async function dashboardReport(db: PoolClient, period: ReportPeriod) {
  const { rows: [summary] } = await db.query<DashboardCounts>(`
    SELECT jsonb_build_object(
      'divisions', (SELECT count(*) FROM divisions WHERE status = 'active'),
      'users', (SELECT count(*) FROM account_access WHERE state = 'active'),
      'tasks', count(*),
      'audit', (SELECT count(*) FROM audit_log
        WHERE ($1::date IS NULL OR changed_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Jakarta'))
          AND ($2::date IS NULL OR changed_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta')))
    ) AS counts,
    jsonb_build_object(
      'pending', count(*) FILTER (WHERE status = 'pending'),
      'on_progress', count(*) FILTER (WHERE status = 'on_progress'),
      'done', count(*) FILTER (WHERE status = 'done')
    ) AS "byStatus"
    FROM tasks
    WHERE ($1::date IS NULL OR date >= $1) AND ($2::date IS NULL OR date <= $2)
  `, [period.from, period.to]);

  return { ...summary, recentActivity: await listAudit(db, period, 8) };
}
