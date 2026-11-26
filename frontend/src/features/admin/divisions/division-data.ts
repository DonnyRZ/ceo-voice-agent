import { queryOptions } from '@tanstack/react-query';
import { api } from '../../../shared/api';

export type DivisionStatus = 'active' | 'archived';

export interface DivisionMember {
  id: string;
  name: string;
  email: string;
}

export interface AdminDivision {
  id: string;
  name: string;
  code: string;
  description: string;
  status: DivisionStatus;
  memberCount: number;
  version: number;
  updatedAt: string;
  members?: DivisionMember[];
}

export function adminDivisionsQuery(filters: { search?: string; status?: DivisionStatus | '' } = {}) {
  const query = new URLSearchParams();
  if (filters.search) query.set('search', filters.search);
  if (filters.status) query.set('status', filters.status);
  return queryOptions({
    queryKey: ['admin', 'divisions', query.toString()],
    queryFn: ({ signal }) => api<AdminDivision[]>(`/api/admin/divisions?${query}`, { signal }),
  });
}

export function adminDivisionQuery(id: string) {
  return queryOptions({
    queryKey: ['admin', 'divisions', 'detail', id],
    queryFn: ({ signal }) => api<AdminDivision>(`/api/admin/divisions/${encodeURIComponent(id)}`, { signal }),
  });
}
