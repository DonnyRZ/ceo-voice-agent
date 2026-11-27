import { queryOptions } from '@tanstack/react-query';
import { api } from '../../../shared/api';
import type { SessionUser } from '../../../shared/types';

export type AdminRole = SessionUser['role'];
export type AdminUserStatus = 'active' | 'pending' | 'failed' | 'revoked' | 'expired';

export interface AdminUser {
  id: string;
  name: string | null;
  email: string;
  role: AdminRole;
  divisionId: string | null;
  divisionName: string | null;
  status: AdminUserStatus;
  kind: 'account' | 'invitation';
  version: number;
  updatedAt: string;
}

export const roleNames: Record<AdminRole, string> = { member: 'Anggota Divisi', superadmin: 'Superadmin', ceo: 'CEO' };
export const accountStatusNames: Record<AdminUserStatus, string> = {
  active: 'Aktif',
  pending: 'Menunggu aktivasi',
  failed: 'Gagal dikirim',
  revoked: 'Akses dicabut',
  expired: 'Kedaluwarsa',
};

export function userDisplayName(user: AdminUser) {
  return user.name || user.email;
}

export function adminUsersQuery(filters: { search?: string; role?: string; divisionId?: string; status?: string } = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
  return queryOptions({
    queryKey: ['admin', 'users', query.toString()],
    queryFn: ({ signal }) => api<AdminUser[]>(`/api/admin/users?${query}`, { signal }),
  });
}

export function adminUserQuery(id: string) {
  return queryOptions({
    queryKey: ['admin', 'users', 'detail', id],
    queryFn: ({ signal }) => api<AdminUser>(`/api/admin/users/${encodeURIComponent(id)}`, { signal }),
  });
}
