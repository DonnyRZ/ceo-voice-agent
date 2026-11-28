import { api } from '../../shared/api';

export type Registration = { name: string; email: string; division_id: string; verified: boolean; delivery: string };
export const registrationQuery = {
  queryKey: ['registration'],
  queryFn: () => api<{ registration: Registration | null }>('/api/registration/status'),
  staleTime: 0,
  refetchInterval: 5000,
};
export type DivisionOptions = { divisions: { id: string; name: string }[]; emailDomains: string[] };
export const divisionOptionsQuery = {
  queryKey: ['registration-divisions'],
  queryFn: () => api<DivisionOptions>('/api/registration/divisions'),
};
