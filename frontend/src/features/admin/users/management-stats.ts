import { useQuery } from '@tanstack/react-query';
import { api } from '../../../shared/api';
import type { Status } from '../../../shared/types';
import type { TaskCounts } from './management-ui';

interface TaskSummaryRow {
  status: Status;
  divisionId?: string;
  picId?: string;
}

export function useManagementTaskCounts(filters: { divisionId?: string; picId?: string } = {}, enabled = true) {
  const summary = useQuery({
    queryKey: ['admin', 'management', 'task-counts'],
    queryFn: ({ signal }) => api<{ byStatus: TaskCounts }>('/api/admin/dashboard', { signal }),
    enabled: enabled && !filters.divisionId && !filters.picId,
  });
  const query = new URLSearchParams();
  if (filters.divisionId) query.set('divisionId', filters.divisionId);
  const tasks = useQuery({
    queryKey: ['admin', 'management', 'scoped-tasks', query.toString()],
    queryFn: ({ signal }) => api<TaskSummaryRow[]>(`/api/admin/tasks?${query}`, { signal }),
    enabled: enabled && Boolean(filters.divisionId || filters.picId),
  });
  if (!filters.divisionId && !filters.picId) return summary.data?.byStatus;
  if (!tasks.data) return undefined;
  const counts: TaskCounts = { pending: 0, on_progress: 0, done: 0 };
  for (const task of tasks.data) {
    if (filters.divisionId && task.divisionId !== filters.divisionId) continue;
    if (filters.picId && task.picId !== filters.picId) continue;
    if (Object.hasOwn(counts, task.status)) counts[task.status] += 1;
  }
  return counts;
}
