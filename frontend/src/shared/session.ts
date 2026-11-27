import { queryOptions } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { api, ApiError } from './api';
import type { MemberSessionUser, SessionUser } from './types';

export const SessionContext = createContext<SessionUser | null>(null);

export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: async ({ signal }) => {
    try {
      const { user } = await api<{ user: SessionUser }>('/api/session', { signal });
      return user;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  refetchOnWindowFocus: true,
  retry: false,
});

export function useCurrentSessionUser(): SessionUser {
  const user = useContext(SessionContext);
  if (!user) throw new Error('Sesi pengguna diperlukan.');
  return user;
}

export function useSessionUser(): MemberSessionUser {
  const user = useCurrentSessionUser();
  if (user.role !== 'member') throw new Error('Sesi Anggota Divisi diperlukan.');
  return user;
}

export function sessionHome(role: SessionUser['role']) {
  return { superadmin: '/admin', ceo: '/ceo/voice', member: '/' }[role];
}
