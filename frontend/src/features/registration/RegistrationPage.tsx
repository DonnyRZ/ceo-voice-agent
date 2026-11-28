import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers, Mail, UserRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../shared/api';
import { divisionOptionsQuery, registrationQuery } from './api';
import { PasswordField } from './PasswordField';
import { RegistrationShell } from './RegistrationShell';

// Only non-secret input is retained while navigating within this tab.
let draft = { name: '', email: '', divisionId: '' };
export function RegistrationPage() {
  const divisions = useQuery(divisionOptionsQuery);
  const current = useQuery(registrationQuery);
  const client = useQueryClient();
  const navigate = useNavigate();
  const [validation, setValidation] = useState('');
  const register = useMutation({
    mutationFn: (input: typeof draft & { password: string; originDevice: 'mobile' | 'desktop' }) =>
      api<{ registration: import('./api').Registration }>('/api/registration', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: (data) => {
      client.setQueryData(registrationQuery.queryKey, data);
      navigate('/register/check-email');
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidation('');
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password'));
    if (password !== form.get('confirm')) { setValidation('Konfirmasi kata sandi belum sama.'); return; }
    draft = { name: String(form.get('name')).trim(), email: String(form.get('email')).trim(), divisionId: String(form.get('divisionId')) };
    register.mutate({ ...draft, password, originDevice: window.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop' });
  }
  const error = register.error instanceof ApiError ? register.error.message
    : register.error ? 'Koneksi terputus. Coba simpan kembali.' : validation;
  return <RegistrationShell compact title="Daftar Anggota Divisi" subtitle="Lengkapi data akun Anda.">
    <form className="registration-card registration-form" onSubmit={submit}>
      {current.data?.registration && <p className="registration-note">
        Data akun sudah disimpan. <Link to="/register/check-email">Lanjutkan verifikasi email</Link>
      </p>}
      <div className="registration-field"><label htmlFor="registration-name">Nama lengkap</label>
        <div className="registration-input"><UserRound aria-hidden="true" />
          <input id="registration-name" name="name" autoComplete="name" required minLength={2} maxLength={120}
            placeholder="Nama lengkap Anda" defaultValue={draft.name} disabled={register.isPending} /></div></div>
      <div className="registration-field"><label htmlFor="registration-email">Email perusahaan</label>
        <div className="registration-input"><Mail aria-hidden="true" />
          <input id="registration-email" name="email" type="email" autoComplete="email" required maxLength={254}
            placeholder="nama@egiresources.com" defaultValue={draft.email} disabled={register.isPending} /></div>
        {!!divisions.data?.emailDomains.length && <small>Gunakan email {divisions.data.emailDomains.join(', ')}.</small>}</div>
      <div className="registration-field"><label htmlFor="registration-division">Divisi</label>
        <div className="registration-input"><Layers aria-hidden="true" />
          <select id="registration-division" name="divisionId" required defaultValue={draft.divisionId}
            disabled={register.isPending || !divisions.data?.divisions.length}>
            <option value="">{divisions.isPending ? 'Memuat divisi…' : 'Pilih divisi'}</option>
            {divisions.data?.divisions.map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}
          </select></div>
        {divisions.error && <div className="auth-error" role="alert">Divisi belum dapat dimuat.
          <button type="button" className="registration-text-action" onClick={() => void divisions.refetch()}>Coba lagi</button></div>}
        {divisions.data && !divisions.data.divisions.length && <p className="auth-error">Belum ada divisi aktif. Hubungi Superadmin.</p>}
      </div>
      <PasswordField disabled={register.isPending} /><PasswordField confirm disabled={register.isPending} />
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="ui-button registration-submit" disabled={register.isPending || !divisions.data?.divisions.length}>
        {register.isPending ? 'Menyimpan…' : 'Simpan dan lanjut'}
      </button>
      <p className="registration-caption registration-next">Berikutnya: verifikasi email perusahaan.</p>
      <p className="registration-login">Sudah punya akun? <Link to="/login">Masuk</Link></p>
    </form>
  </RegistrationShell>;
}
