import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
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
    const stripFragment = () => window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    const changed = () => {
      const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
      stripFragment();
      if (token) setLink((previous) => ({ token, sequence: previous.sequence + 1 }));
    };
    stripFragment();
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  return <VerificationForm key={link.sequence} token={link.token} />;
}

function VerificationForm({ token }: { token: string }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const verify = useMutation({
    mutationFn: () => api<Verification>('/api/registration/verify', { method: 'POST', body: JSON.stringify({ token }) }),
    onSuccess: (result) => {
      if (result.same_browser && result.registration) {
        client.setQueryData(registrationQuery.queryKey, { registration: result.registration });
        navigate('/register/check-email', { replace: true });
      }
    },
  });
  if (verify.data) return <VerificationResult origin={verify.data.origin_device} />;
  const invalid = !token || (verify.error instanceof ApiError && verify.error.status === 400);
  return <RegistrationShell joined showSteps={false} icon={invalid ? CircleAlert : Mail}
    title={invalid ? 'Tautan tidak berlaku' : 'Konfirmasi email Anda'}
    subtitle={invalid ? 'Gunakan email verifikasi terbaru.' : 'Aktifkan akun Anggota Divisi Anda.'}>
    <section className="registration-card registration-email-card">
      {invalid ? <><p>Tautan sudah digunakan, kedaluwarsa, atau tidak lengkap.</p>
        <p className="registration-note">Kembali ke browser tempat Anda mendaftar untuk memeriksa status atau mengirim ulang email.</p>
        <Link className="ui-button registration-wide" to="/register/check-email">Periksa pendaftaran</Link>
        <p className="registration-next"><Link to="/register">Daftar kembali</Link></p></>
        : <><p>Tekan tombol di bawah untuk memverifikasi email perusahaan yang Anda daftarkan.</p>
          <button className="ui-button registration-wide" onClick={() => verify.mutate()} disabled={verify.isPending}>
            {verify.isPending ? 'Memverifikasi…' : 'Verifikasi email'}</button>
          <p className="registration-caption registration-next">Tautan berlaku 24 jam dan hanya dapat digunakan sekali.</p></>}
      {verify.error && !invalid && <p className="auth-error" role="alert">{verify.error instanceof ApiError ? verify.error.message : 'Koneksi gagal. Coba lagi.'}</p>}
    </section>
  </RegistrationShell>;
}
