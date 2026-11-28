import { AsyncLocalStorage } from 'node:async_hooks';

export type LoginPortal = 'user' | 'superadmin';
type Admission = { portal: LoginPortal; denied: boolean };

// Set only by server routes, never by a client-supplied role, header, or referrer.
export const loginAdmission = new AsyncLocalStorage<Admission>();

export function admitsLogin(role: string) {
  const admission = loginAdmission.getStore();
  if (!admission) return true; // Authenticated password changes also renew sessions.
  const allowed = admission.portal === 'superadmin'
    ? role === 'superadmin'
    : role === 'member' || role === 'ceo';
  if (!allowed) admission.denied = true;
  return allowed;
}
