import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, LogOut, Mail } from 'lucide-react';
import { api } from '../../shared/api';
import { sessionQuery, useSessionUser } from '../../shared/session';
import './auth.css';

export function AccountPage() {
  const user = useSessionUser();
  const initials = user.name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api('/api/auth/sign-out', { method: 'POST', body: '{}' }),
    onSuccess: async () => {
      await queryClient.cancelQueries();
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      queryClient.setQueryData(sessionQuery.queryKey, null);
    },
  });

  return (
    <section className="account-page" aria-labelledby="account-title">
      <h1 id="account-title" className="page-title">Akun</h1>
      <div className="account-heading">
        <span className="account-icon" aria-hidden="true">{initials}</span>
        <div>
          <h2>{user.name}</h2>
          <p>Anggota Divisi {user.divisionName}</p>
          <p className="account-email"><Mail aria-hidden="true" />{user.email}</p>
        </div>
      </div>
      <div className="account-panel">
        {logout.isError && <p className="auth-error" role="alert">Tidak dapat keluar sekarang. Coba lagi.</p>}
        <button type="button" className="account-logout" onClick={() => logout.mutate()} disabled={logout.isPending}>
          <LogOut aria-hidden="true" />
          {logout.isPending ? 'Sedang keluar…' : 'Keluar'}
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
