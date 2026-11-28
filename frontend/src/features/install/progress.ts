import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api';
import { registrationQuery, type Registration } from '../registration/api';
import { clearRegistrationDraft } from '../registration/draft';

export function useOnboardingProgress() {
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (step: string) => api<{ registration: Registration }>('/api/registration/progress', { method: 'POST', body: JSON.stringify({ step }) }),
    onSuccess: (data) => client.setQueryData(registrationQuery.queryKey, data),
    onError: () => { void client.invalidateQueries({ queryKey: registrationQuery.queryKey }); },
  });
  const complete = useMutation({
    mutationFn: (method: string) => api<{ registration: Registration }>('/api/registration/complete', { method: 'POST', body: JSON.stringify({ method }) }),
    onSuccess: (data) => { client.setQueryData(registrationQuery.queryKey, data); clearRegistrationDraft(); },
    onError: () => { void client.invalidateQueries({ queryKey: registrationQuery.queryKey }); },
  });
  return { save, complete, busy: save.isPending || complete.isPending, error: save.error ?? complete.error };
}
