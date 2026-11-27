import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, LogOut, Mail, Settings, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../../shared/api';
import { sessionQuery, useCurrentSessionUser } from '../../../shared/session';
import './ceo-account.css';

export function CeoAccountPage() {
  const user = useCurrentSessionUser();
  const queryClient = useQueryClient();
  const initials = user.name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  const logout = useMutation({
    mutationFn: () => api('/api/auth/sign-out', { method: 'POST', body: '{}' }),
    onSuccess: async () => {
      await queryClient.cancelQueries();
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      queryClient.setQueryData(sessionQuery.queryKey, null);
    },
  });

  return (
    <section className="ceo-account-page" aria-labelledby="ceo-account-title">
      <h1 id="ceo-account-title" className="page-title">Akun</h1>
      <p className="ceo-account-description">Kelola profil dan pengaturan akun Anda.</p>
      <div className="ceo-account-identity">
        <span className="ceo-account-avatar" aria-hidden="true">{initials}</span>
        <div>
          <h2>{user.name}</h2>
          <p>CEO</p>
          <p className="ceo-account-email"><Mail aria-hidden="true" />{user.email}</p>
        </div>
      </div>
      <div className="ceo-account-menu">
        <Link className="ceo-account-action" to="/ceo/account/security">
          <Shield aria-hidden="true" /><span>Keamanan akun</span><ChevronRight aria-hidden="true" />
        </Link>
        <Link className="ceo-account-action" to="/ceo/settings">
          <Settings aria-hidden="true" /><span>Pengaturan</span><ChevronRight aria-hidden="true" />
        </Link>
        <button type="button" className="ceo-account-action" onClick={() => logout.mutate()} disabled={logout.isPending}>
          <LogOut aria-hidden="true" /><span>{logout.isPending ? 'Sedang keluar…' : 'Keluar'}</span><ChevronRight aria-hidden="true" />
        </button>
      </div>
      {logout.isError && <p className="ceo-account-error" role="alert">Belum dapat keluar. Periksa koneksi, lalu coba lagi.</p>}
    </section>
  );
}
