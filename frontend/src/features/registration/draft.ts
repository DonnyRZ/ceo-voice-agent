import { useEffect, useState } from 'react';

const key = 'rk.registration.form';
const empty = { name: '', email: '', divisionId: '' };
export const clearRegistrationDraft = () => { try { localStorage.removeItem(key); } catch { /* Storage may be disabled. */ } };
export function useRegistrationDraft() {
  const [draft, setDraft] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? '{}');
      return Object.fromEntries(Object.keys(empty).map((field) => [field, typeof stored[field] === 'string' ? stored[field] : ''])) as typeof empty;
    } catch { return empty; }
  });
  useEffect(() => {
    // Explicit allowlist: passwords, verification tokens and browser claims never enter storage.
    try { localStorage.setItem(key, JSON.stringify({ name: draft.name, email: draft.email, divisionId: draft.divisionId })); } catch { /* Continue without storage. */ }
  }, [draft]);
  return [draft, setDraft] as const;
}
