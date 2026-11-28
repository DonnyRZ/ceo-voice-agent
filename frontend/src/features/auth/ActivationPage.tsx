import { useMutation } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../shared/api';
import { Brand } from '../../shared/brand';
import './auth.css';
import './auth-mobile.css';
import './activation.css';

export function ActivationPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const token = new URLSearchParams(location.hash.slice(1)).get('token');
  const activated = location.state?.activated === true;
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [validation, setValidation] = useState('');
  const request = useMutation({
    mutationFn: () => api('/api/activate', {
      method: 'POST',
      body: JSON.stringify({ token, name: name.trim(), password }),
    }),
    onSuccess: () => {
      setPassword('');
      setConfirmation('');
      void navigate('/activate', { replace: true, state: { activated: true } });
    },
  });

  function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    if (!name.trim()) {
      setValidation('Masukkan nama lengkap.');
      return;
    }
    if (password !== confirmation) {
      setValidation('Konfirmasi kata sandi harus sama.');
      return;
    }
    setValidation('');
    request.mutate();
  }

  const error = validation || (request.isError
    ? request.error instanceof ApiError
      ? Object.values(request.error.fields)[0] ?? request.error.message
      : 'Aktivasi belum berhasil. Coba lagi.'
    : '');

  return (
    <main className="auth-shell">
      <Brand to="/login" />
      <section className="auth-card activation-card" aria-labelledby="activation-title">
        <header className="auth-intro">
          <span className="auth-intro-icon"><KeyRound aria-hidden="true" /></span>
          <div>
            <h1 id="activation-title">{activated ? 'Akun sudah aktif' : 'Aktivasi Akun'}</h1>
            {token && !activated && <p>Lengkapi nama dan kata sandi untuk mengaktifkan akun.</p>}
          </div>
        </header>
        {activated || !token ? (
          <div className="auth-form">
            {activated
              ? <p role="status">Akun Anda sudah siap digunakan.</p>
              : <p role="alert">Tautan aktivasi tidak tersedia. Minta undangan baru dari Superadmin.</p>}
            <Link className="ui-button" to="/login">Masuk</Link>
          </div>
        ) : (
          <form className="auth-form" onSubmit={activate}>
            <label htmlFor="activation-name">Nama lengkap</label>
            <input id="activation-name" autoComplete="name" required maxLength={120} value={name}
              onChange={(event) => setName(event.target.value)} disabled={request.isPending} />
            <label htmlFor="activation-password">Kata sandi</label>
            <input id="activation-password" type="password" autoComplete="new-password" required value={password}
              onChange={(event) => setPassword(event.target.value)} disabled={request.isPending} />
            <label htmlFor="activation-confirmation">Konfirmasi kata sandi</label>
            <input id="activation-confirmation" type="password" autoComplete="new-password" required value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)} disabled={request.isPending} />
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="ui-button" type="submit" disabled={request.isPending}>
              {request.isPending ? <span className="loading-inline" aria-live="polite"><span className="ui-spinner" aria-hidden="true" />Mengaktifkan</span> : 'Aktifkan akun'}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
