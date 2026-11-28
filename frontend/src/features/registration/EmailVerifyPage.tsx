import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../shared/api';
import { registrationQuery, type Registration } from './api';
import { VerificationResult } from './VerificationResult';
import { RegistrationShell } from './RegistrationShell';

type Verification = { email: string; origin_device: 'mobile' | 'desktop' | null; same_browser: boolean; registration: Registration | null };
export function RegistrationVerifyPage() {
  const readToken = () => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
  const [link, setLink] = useState(() => ({ token: readToken(), sequence: 0 }));
  useEffect(() => {
    const changed = () => setLink((previous) => ({ token: readToken(), sequence: previous.sequence + 1 }));
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  return <VerificationForm key={link.sequence} token={link.token} />;
}

function VerificationForm({ token }: { token: string }) {
  const client = useQueryClient();
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const navigate = useNavigate();
  const verify = useMutation({
    mutationFn: async () => {
      const result = await api<Verification>('/api/registration/verify', { method: 'POST', body: JSON.stringify({ token, ...(needsPassword ? { password } : {}) }) });
      if (!result || typeof result.email !== 'string' || !result.email.includes('@')
        || !['mobile', 'desktop', null].includes(result.origin_device) || typeof result.same_browser !== 'boolean'
        || !('registration' in result) || (result.registration !== null && result.registration.verified !== true)) {
        throw new ApiError(502, 'Status verifikasi belum dapat dipastikan. Coba lagi.');
      }
      return result;
    },
    onSuccess: (result) => {
      if (!mounted.current) return;
      setPassword('');
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
      if (result.same_browser && result.registration) {
        client.setQueryData(registrationQuery.queryKey, { registration: result.registration });
        navigate('/register/check-email', { replace: true });
      }
    },
    onError: (error) => {
      if (mounted.current && error instanceof ApiError && error.status === 428 && error.fields.password === 'required') setNeedsPassword(true);
    },
  });
  if (verify.data) return <VerificationResult origin={verify.data.origin_device} />;
  const passwordChallenge = verify.error instanceof ApiError && verify.error.status === 428 && verify.error.fields.password === 'required';
  const invalid = !token || (verify.error instanceof ApiError && verify.error.status === 400);
  return <RegistrationShell joined showSteps={false} icon={invalid ? CircleAlert : Mail}
    title={invalid ? 'Tautan tidak berlaku' : needsPassword ? 'Konfirmasi pendaftaran' : 'Konfirmasi email Anda'}
    subtitle={invalid ? 'Gunakan email verifikasi terbaru.' : needsPassword ? 'Lanjutkan dengan aman di browser ini.' : 'Verifikasi email perusahaan Anda.'}>
    <section className="registration-card registration-email-card">
      {invalid ? <><p>Tautan sudah digunakan, kedaluwarsa, atau tidak lengkap.</p>
        <p className="registration-note">Kembali ke browser tempat Anda mendaftar untuk memeriksa status atau mengirim ulang email.</p>
        <Link className="ui-button registration-wide" to="/register/check-email">Periksa pendaftaran</Link>
        <p className="registration-next"><Link to="/register">Daftar kembali</Link></p></>
        : <form className="registration-form" onSubmit={(event) => { event.preventDefault(); if (!verify.isPending) verify.mutate(); }}>
          <p>{needsPassword ? 'Masukkan kata sandi yang Anda isi saat pendaftaran.' : 'Tekan tombol di bawah untuk memverifikasi email perusahaan yang Anda daftarkan.'}</p>
          {needsPassword && <div className="registration-field">
            <label htmlFor="verification-password">Kata sandi pendaftaran</label>
            <div className="registration-input"><LockKeyhole aria-hidden="true" />
              <input id="verification-password" type={visible ? 'text' : 'password'} autoComplete="current-password" required
                minLength={8} maxLength={128} value={password} disabled={verify.isPending} onChange={(event) => setPassword(event.target.value)} />
              <button type="button" aria-label={visible ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'} onClick={() => setVisible(!visible)}>
                {visible ? <EyeOff /> : <Eye />}</button></div>
            <small>Anda tidak perlu membuat kata sandi baru.</small>
          </div>}
          <button type="submit" className="ui-button registration-wide" disabled={verify.isPending} aria-busy={verify.isPending}>
            {verify.isPending ? <span className="loading-inline" aria-live="polite"><span className="ui-spinner" aria-hidden="true" />Memverifikasi</span>
              : needsPassword ? 'Verifikasi dan lanjutkan' : 'Verifikasi email'}</button>
          <p className="registration-caption registration-next">{needsPassword ? 'Tautan dapat dibuka di browser mana pun.' : 'Tautan berlaku 24 jam dan hanya dapat digunakan sekali.'}</p></form>}
      {verify.error && !invalid && !passwordChallenge && <p className="auth-error" role="alert">{verify.error instanceof ApiError ? verify.error.message : 'Koneksi gagal. Coba lagi.'}</p>}
    </section>
  </RegistrationShell>;
}
