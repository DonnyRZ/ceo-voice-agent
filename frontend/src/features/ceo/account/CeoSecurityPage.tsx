import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Shield } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../../shared/api';
import { sessionQuery } from '../../../shared/session';
import './ceo-account.css';

export function CeoSecurityPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [validation, setValidation] = useState('');
  const queryClient = useQueryClient();
  const changePassword = useMutation({
    mutationFn: () => api('/api/account/password', {
      method: 'POST', body: JSON.stringify({ currentPassword, newPassword }),
    }),
    onSuccess: async () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    changePassword.reset();
    if (newPassword !== confirmation) return setValidation('Konfirmasi kata sandi belum sesuai.');
    if (currentPassword === newPassword) return setValidation('Gunakan kata sandi baru yang berbeda.');
    setValidation('');
    changePassword.mutate();
  }

  const error = changePassword.error instanceof ApiError
    ? changePassword.error.message : 'Kata sandi belum berhasil diperbarui. Coba lagi.';
  return (
    <section className="ceo-account-page" aria-labelledby="ceo-security-title">
      <h1 id="ceo-security-title" className="page-title">Keamanan akun</h1>
      <Link className="ceo-account-back" to="/ceo/account"><ArrowLeft aria-hidden="true" />Akun</Link>
      <form className="ceo-security-form" onSubmit={submit}>
        <header><Shield aria-hidden="true" /><div><h2>Ubah kata sandi</h2><p>Sesi lain akan dikeluarkan setelah perubahan berhasil.</p></div></header>
        <label htmlFor="ceo-current-password">Kata sandi saat ini</label>
        <input id="ceo-current-password" type="password" autoComplete="current-password" required maxLength={128}
          value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} disabled={changePassword.isPending} />
        <label htmlFor="ceo-new-password">Kata sandi baru</label>
        <input id="ceo-new-password" type="password" autoComplete="new-password" required minLength={8} maxLength={128}
          aria-describedby="ceo-password-requirement" value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)} disabled={changePassword.isPending} />
        <p id="ceo-password-requirement" className="ceo-account-hint">Gunakan 8–128 karakter.</p>
        <label htmlFor="ceo-confirm-password">Konfirmasi kata sandi baru</label>
        <input id="ceo-confirm-password" type="password" autoComplete="new-password" required maxLength={128}
          value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={changePassword.isPending} />
        {(validation || changePassword.isError) && <p className="ceo-account-error" role="alert">{validation || error}</p>}
        {changePassword.isSuccess && <p className="ceo-account-feedback" role="status">Kata sandi berhasil diperbarui. Sesi lain telah dikeluarkan.</p>}
        <button type="submit" className="ui-button" disabled={changePassword.isPending}>
          {changePassword.isPending ? <span className="loading-inline" aria-live="polite"><span className="ui-spinner" aria-hidden="true" />Menyimpan</span> : 'Simpan kata sandi'}
        </button>
      </form>
    </section>
  );
}
