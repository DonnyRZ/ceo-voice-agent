import { queryOptions } from '@tanstack/react-query';
import { api } from '../../../shared/api';
import type { Status, Task } from '../../../shared/types';
import type { AdminAudit } from '../audit/audit-data';
import { monthRange } from '../../timesheets/task-dates';

export interface AdminTask extends Task {
  divisionId: string;
  divisionName: string;
}

export interface AdminTaskHistory {
  id: string;
  changedAt: string;
  previousStatus: Status;
  status: Status;
  actorName: string | null;
}

interface AdminDashboard {
  counts: { divisions: number; users: number; tasks: number; audit: number };
  byStatus: Record<Status, number>;
  recentActivity: AdminAudit[];
}

const freshness = { staleTime: 0, refetchOnWindowFocus: 'always', refetchInterval: 30_000 } as const;

export function adminDashboardQuery(month: string) {
  const query = new URLSearchParams(monthRange(month));
  return queryOptions({
    queryKey: ['admin', 'dashboard', month],
    ...freshness,
    queryFn: ({ signal }) => api<AdminDashboard>(`/api/admin/dashboard?${query}`, { signal }),
  });
}

export function adminTasksQuery(filters = new URLSearchParams()) {
  const query = filters.toString();
  return queryOptions({
    queryKey: ['admin', 'tasks', query],
    ...freshness,
    queryFn: ({ signal }) => api<AdminTask[]>(`/api/admin/tasks?${query}`, { signal }),
  });
}

export function adminTaskQuery(id: string) {
  return queryOptions({
    queryKey: ['admin', 'tasks', 'detail', id],
    ...freshness,
    queryFn: ({ signal }) => api<AdminTask>(`/api/admin/tasks/${encodeURIComponent(id)}`, { signal }),
  });
}

export function adminTaskHistoryQuery(id: string) {
  return queryOptions({
    queryKey: ['admin', 'tasks', 'history', id],
    ...freshness,
    queryFn: ({ signal }) => api<AdminTaskHistory[]>(`/api/admin/tasks/${encodeURIComponent(id)}/history`, { signal }),
  });
}

export function validMonth(value: string | null | undefined): value is string {
  return !!value && /^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/.test(value);
}

export function reportFilters(params: URLSearchParams, divisionId?: string) {
  const result = new URLSearchParams();
  for (const key of ['divisionId', 'projectId', 'picId', 'status', 'search']) {
    const value = params.get(key);
    if (value) result.set(key, value);
  }
  if (divisionId) result.set('divisionId', divisionId);
  const period = params.get('period');
  if (validMonth(period)) {
    const { from, to } = monthRange(period);
    result.set('from', from);
    result.set('to', to);
  }
  return result;
}

export function countStatuses(tasks?: Pick<AdminTask, 'status'>[]) {
  return tasks?.reduce<Record<Status, number>>((counts, task) => {
    counts[task.status] += 1;
    return counts;
  }, { pending: 0, on_progress: 0, done: 0 });
}
