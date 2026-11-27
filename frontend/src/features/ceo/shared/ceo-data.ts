import { queryOptions } from '@tanstack/react-query';
import { api } from '../../../shared/api';
import { monthRange } from '../../timesheets/task-dates';
import type { CeoDashboard, CeoDivision, CeoDivisionDetail, CeoProjectDetail, CeoTask, CeoTaskHistory } from './ceo-types';

const freshness = { staleTime: 0, refetchOnWindowFocus: 'always' as const, refetchInterval: 30_000 };

export function validMonth(value: string | null) {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : '';
}

export function ceoPeriod(month: string) {
  return month ? new URLSearchParams(monthRange(month)) : new URLSearchParams();
}

export function withPeriod(path: string, month: string) {
  return month ? `${path}?month=${encodeURIComponent(month)}` : path;
}

export function ceoDashboardQuery(month: string) {
  return queryOptions({
    queryKey: ['ceo', 'dashboard', month],
    queryFn: ({ signal }) => api<CeoDashboard>(`/api/ceo/dashboard?${ceoPeriod(month)}`, { signal }),
    ...freshness,
  });
}

export function ceoDivisionsQuery(search = '', month = '', status = 'active') {
  const params = ceoPeriod(month);
  if (search) params.set('search', search);
  if (status !== 'all') params.set('status', status);
  return queryOptions({
    queryKey: ['ceo', 'divisions', search, month, status],
    queryFn: ({ signal }) => api<CeoDivision[]>(`/api/ceo/divisions?${params}`, { signal }),
    ...freshness,
  });
}

export function ceoDivisionQuery(id: string, month = '') {
  return queryOptions({
    queryKey: ['ceo', 'division', id, month],
    queryFn: ({ signal }) => api<CeoDivisionDetail>(`/api/ceo/divisions/${encodeURIComponent(id)}?${ceoPeriod(month)}`, { signal }),
    ...freshness,
  });
}

export function ceoProjectQuery(id: string, month = '') {
  return queryOptions({
    queryKey: ['ceo', 'project', id, month],
    queryFn: ({ signal }) => api<CeoProjectDetail>(`/api/ceo/projects/${encodeURIComponent(id)}?${ceoPeriod(month)}`, { signal }),
    ...freshness,
  });
}

export function ceoTaskQuery(id: string) {
  return queryOptions({
    queryKey: ['ceo', 'task', id],
    queryFn: ({ signal }) => api<CeoTask>(`/api/ceo/tasks/${encodeURIComponent(id)}`, { signal }),
    ...freshness,
  });
}

export function ceoTaskHistoryQuery(id: string) {
  return queryOptions({
    queryKey: ['ceo', 'task-history', id],
    queryFn: ({ signal }) => api<CeoTaskHistory[]>(`/api/ceo/tasks/${encodeURIComponent(id)}/history`, { signal }),
    ...freshness,
  });
}
