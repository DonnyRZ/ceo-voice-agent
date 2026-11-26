import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BriefcaseBusiness, Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, ApiError } from '../../shared/api';
import { Brand } from '../../shared/brand';
import { sessionHome, sessionQuery } from '../../shared/session';
import type { SessionUser } from '../../shared/types';
import './auth.css';
import './auth-mobile.css';

export function LoginPage() {
  const queryClient = useQueryClient();
  const session = useQuery(sessionQuery);
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const requested: unknown = location.state?.from?.pathname;

  const login = useMutation({
    mutationFn: async () => {
      await api('/api/auth/sign-in/email', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password, rememberMe: false }),
      });
      return api<{ user: SessionUser }>('/api/session');
    },
    onSuccess: async ({ user }) => {
      await queryClient.cancelQueries();
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      queryClient.setQueryData(sessionQuery.queryKey, user);
    },
  });

  if (session.data) {
    const home = sessionHome(session.data.role);
    const safe = typeof requested === 'string' && requested.startsWith('/') && !requested.startsWith('//')
      && !requested.includes('\\') && requested !== '/login' && requested !== '/activate';
    const adminPage = safe && (requested === '/admin' || requested.startsWith('/admin/'));
    const matchesRole = safe && adminPage === (session.data.role === 'superadmin');
    return <Navigate to={matchesRole ? requested : home} replace />;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    login.mutate();
  }

  const status = login.error instanceof ApiError ? login.error.status : null;
  const loginMessage = status === 401
    ? 'Email atau kata sandi tidak sesuai.'
    : status === 429
      ? 'Terlalu banyak percobaan masuk. Coba lagi nanti.'
      : 'Tidak dapat masuk sekarang. Coba lagi.';

  return (
    <main className="auth-shell">
      <Brand to="/login" />
      <section className="auth-card" aria-labelledby="login-title">
        <header className="auth-intro">
          <span className="auth-intro-icon"><BriefcaseBusiness aria-hidden="true" /></span>
          <div>
            <h1 id="login-title">Masuk ke Ruang Kerja</h1>
            <p>Gunakan email perusahaan untuk masuk.</p>
          </div>
        </header>
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="work-email">Email perusahaan</label>
          <div className="auth-input">
            <Mail className="auth-input-icon" aria-hidden="true" />
            <input id="work-email" type="email" autoComplete="username" value={email}
              placeholder="nama@perusahaan.co.id" required disabled={login.isPending}
              onChange={(event) => setEmail(event.currentTarget.value)} />
          </div>
          <label htmlFor="work-password">Kata sandi</label>
          <div className="auth-input">
            <LockKeyhole className="auth-input-icon" aria-hidden="true" />
            <input id="work-password" type={passwordVisible ? 'text' : 'password'}
              autoComplete="current-password" value={password} placeholder="Masukkan kata sandi"
              onChange={(event) => setPassword(event.currentTarget.value)} required disabled={login.isPending} />
            <button type="button" className="auth-password-toggle"
              onClick={() => setPasswordVisible((visible) => !visible)}
              aria-label={passwordVisible ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}>
              {passwordVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </button>
          </div>
          {login.error && <p className="auth-error" role="alert">{loginMessage}</p>}
          <button type="submit" className="ui-button" disabled={login.isPending}>
            {login.isPending ? 'Sedang masuk…' : 'Masuk'}
          </button>
        </form>
      </section>
    </main>
  );
}
