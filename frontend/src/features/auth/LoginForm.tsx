import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../../shared/api';
import { sessionQuery } from '../../shared/session';
import type { SessionUser } from '../../shared/types';

export function LoginForm({ superadmin = false }: { superadmin?: boolean }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const login = useMutation({
    mutationFn: async () => {
      const endpoint = superadmin ? '/api/superadmin/auth/sign-in/email' : '/api/auth/sign-in/email';
      await api(endpoint, {
        method: 'POST', body: JSON.stringify({ email: email.trim(), password, rememberMe: false }),
      });
      return api<{ user: SessionUser }>('/api/session');
    },
    onSuccess: async ({ user }) => {
      await queryClient.cancelQueries();
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      queryClient.setQueryData(sessionQuery.queryKey, user);
    },
  });
  const status = login.error instanceof ApiError ? login.error.status : null;
  const message = status === 401 ? 'Email atau kata sandi tidak sesuai.'
    : status === 429 ? 'Terlalu banyak percobaan masuk. Coba lagi nanti.'
      : 'Tidak dapat masuk sekarang. Coba lagi.';
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    login.mutate();
  }
  return (
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
        <input id="work-password" type={passwordVisible ? 'text' : 'password'} autoComplete="current-password"
          value={password} placeholder="Masukkan kata sandi" required disabled={login.isPending}
          onChange={(event) => setPassword(event.currentTarget.value)} />
        <button type="button" className="auth-password-toggle" onClick={() => setPasswordVisible(!passwordVisible)}
          aria-label={passwordVisible ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}>
          {passwordVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </div>
      {login.error && <p className="auth-error" role="alert">{message}</p>}
      <button type="submit" className="ui-button" disabled={login.isPending}>
        {login.isPending ? 'Sedang masuk…' : 'Masuk'}
        {superadmin && <ArrowRight aria-hidden="true" />}
      </button>
    </form>
  );
}
