import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../shared/api';
import { registrationQuery } from './api';
import { RegistrationShell } from './RegistrationShell';

export function RegistrationEmailPage() {
  const current = useQuery(registrationQuery);
  const client = useQueryClient();
  const resend = useMutation({
    mutationFn: () => api<{ delivery: string }>('/api/registration/resend', { method: 'POST', body: '{}' }),
    onSettled: () => client.invalidateQueries({ queryKey: registrationQuery.queryKey }),
  });
  const registration = current.data?.registration;
  const failed = (resend.data?.delivery ?? registration?.delivery) === 'failed';
  return <RegistrationShell showSteps={false} title={registration?.verified ? 'Email terverifikasi' : 'Verifikasi email perusahaan'}
    subtitle={registration?.verified ? 'Akun Anggota Divisi Anda sudah aktif.' : 'Buka tautan verifikasi untuk mengaktifkan akun.'}>
    <section className="registration-card">
      <MailCheck className="registration-feature-icon" aria-hidden="true" />
      {current.isPending ? <p role="status">Memeriksa pendaftaran…</p> : current.error ? <p role="alert">Pendaftaran belum dapat diperiksa.
        <button className="registration-text-action" onClick={() => void current.refetch()}>Coba lagi</button></p>
        : !registration ? <><p>Tidak ada pendaftaran aktif pada browser ini.</p><Link className="ui-button" to="/register">Daftar akun</Link></>
        : <>{!registration.verified && <><p>{failed ? 'Email belum terkirim. Coba kirim ulang.' : 'Periksa kotak masuk dan spam di'} <strong>{registration.email}</strong>.</p>
          <p>Tautan berlaku 24 jam. Akun belum dapat masuk sebelum email diverifikasi.</p>
          <button className="ui-button" onClick={() => resend.mutate()} disabled={resend.isPending}>
            {resend.isPending ? 'Mengirim…' : 'Kirim ulang email'}</button>
          <p className="registration-caption">Pengiriman ulang tersedia setelah satu menit, maksimal lima kali.</p></>}
          {resend.error && <p className="auth-error" role="alert">{resend.error instanceof ApiError ? resend.error.message : 'Email belum dapat dikirim.'}</p>}
          <div className="registration-actions"><Link className="ui-button" to="/login">Masuk</Link>
            <Link className="ui-button ui-button--outline" to="/onboarding">Panduan pemasangan</Link></div>
        </>}
    </section>
  </RegistrationShell>;
}

export function RegistrationVerifyPage() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '');
  const client = useQueryClient();
  useEffect(() => { window.history.replaceState(null, '', window.location.pathname); }, []);
  const verify = useMutation({
    mutationFn: () => api<{ email: string }>('/api/registration/verify', { method: 'POST', body: JSON.stringify({ token }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: registrationQuery.queryKey }),
  });
  return <RegistrationShell showSteps={false} title={verify.isSuccess ? 'Email terverifikasi' : 'Konfirmasi email Anda'}
    subtitle={verify.isSuccess ? 'Akun Anggota Divisi Anda sudah aktif.' : 'Aktifkan akun yang Anda daftarkan.'}>
    <section className="registration-card">
      {verify.isSuccess ? <><p>Verifikasi berhasil. Gunakan email dan kata sandi pendaftaran untuk masuk.</p>
        <Link className="ui-button" to="/login">Masuk ke Ruang Kerja</Link></>
        : token ? <><p>Tekan tombol berikut untuk memverifikasi email perusahaan. Tautan hanya dapat digunakan sekali.</p>
          <button className="ui-button" onClick={() => verify.mutate()} disabled={verify.isPending}>
            {verify.isPending ? 'Memverifikasi…' : 'Verifikasi email'}</button></>
          : <p>Tautan verifikasi tidak lengkap. Buka tautan dari email terbaru.</p>}
      {verify.error && <p className="auth-error" role="alert">{verify.error instanceof ApiError ? verify.error.message : 'Koneksi gagal. Coba lagi.'}</p>}
      {!verify.isSuccess && <p><Link to="/register/check-email">Kembali ke verifikasi email</Link>{' · '}<Link to="/login">Masuk</Link></p>}
    </section>
  </RegistrationShell>;
}
