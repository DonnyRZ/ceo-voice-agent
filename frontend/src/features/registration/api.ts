import { api } from '../../shared/api';

export type Registration = { name: string; email: string; division_id: string; verified: boolean;
  delivery: 'not_sent' | 'pending' | 'sent' | 'failed'; origin_device: 'mobile' | 'desktop' | null;
  retry_after_seconds: number; sends_remaining: number; completed: boolean; step: string };
export const registrationQuery = {
  queryKey: ['registration'],
  queryFn: () => api<{ registration: Registration | null }>('/api/registration/status'),
  staleTime: 0,
  refetchInterval: (query: { state: { data?: { registration: Registration | null } } }) =>
    query.state.data?.registration?.verified ? false : 3000,
};
export type DivisionOptions = { divisions: { id: string; name: string }[]; emailDomains: string[] };
export const divisionOptionsQuery = {
  queryKey: ['registration-divisions'],
  queryFn: () => api<DivisionOptions>('/api/registration/divisions'),
};
