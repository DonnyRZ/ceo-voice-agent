import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Clock3, Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../shared/api';
import { registrationQuery, type Registration } from './api';
import { RegistrationShell } from './RegistrationShell';

export function RegistrationEmailPage() {
  const current = useQuery(registrationQuery);
  const client = useQueryClient();
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const send = useMutation({
    mutationFn: () => api<{ registration: Registration }>('/api/registration/send-email', { method: 'POST', body: '{}' }),
    onSuccess: (data) => client.setQueryData(registrationQuery.queryKey, data),
    onError: () => { void client.invalidateQueries({ queryKey: registrationQuery.queryKey }); },
  });
  const registration = current.data?.registration;
  const mobile = registration?.origin_device === 'mobile';
  const verified = registration?.verified === true;
  const sent = registration?.delivery === 'sent';
  const failed = registration?.delivery === 'failed';
  const seconds = Math.max(0, Math.ceil((registration?.retry_after_seconds ?? 0) - Math.max(0, now - current.dataUpdatedAt) / 1000));
  const sending = send.isPending || (registration?.delivery === 'pending' && seconds > 0);
  const finishedDesktop = verified && registration.origin_device === 'desktop';
  const title = finishedDesktop ? 'Registrasi selesai' : verified ? 'Email terverifikasi'
    : failed ? 'Email belum terkirim' : sent ? 'Periksa email Anda' : 'Verifikasi email';
  return <RegistrationShell step={verified ? 3 : 2} flow={mobile ? 'mobile' : 'desktop'} joined showSteps={!!registration?.origin_device}
    icon={verified ? Check : Mail} title={title}
    subtitle={finishedDesktop ? 'Email perusahaan Anda sudah terverifikasi.'
      : verified ? mobile ? 'Lanjutkan untuk menyiapkan aplikasi di HP Anda.' : 'Kembali ke browser tempat Anda mendaftar.'
        : failed ? 'Data akun tersimpan. Coba kirim email kembali.'
          : sent ? 'Tautan verifikasi sudah dikirim.' : 'Satu langkah lagi untuk mengaktifkan akun Anda.'}>
    <section className="registration-card registration-email-card">
      {current.isPending ? <p role="status">Memeriksa pendaftaran…</p>
        : current.error ? <><p role="alert">Pendaftaran belum dapat diperiksa.</p>
          <button className="ui-button" onClick={() => void current.refetch()}>Coba lagi</button></>
          : !registration ? <><p>Tidak ada pendaftaran aktif pada browser ini. Gunakan browser tempat Anda mendaftar.</p>
            <Link className="ui-button" to="/register">Daftar kembali</Link></>
            : verified ? <>
              <div className="registration-verified"><span className="registration-status-icon"><Check aria-hidden="true" /></span>
                <div><h2>Akun {mobile ? 'Anda' : 'Anggota Divisi Anda'} sudah aktif.</h2>
                  <p>{mobile ? 'Proses penyiapan aplikasi belum selesai.' : 'Masuk menggunakan email dan kata sandi yang Anda daftarkan.'}</p></div></div>
              {mobile && <p className="registration-note"><strong>Berikutnya:</strong> pilih Android atau iPhone, lalu ikuti panduan pemasangan.</p>}
              <Link className="ui-button registration-wide" to={mobile ? '/onboarding' : '/login'}>
                {mobile ? <>Lanjutkan <ArrowRight /></> : 'Masuk ke Ruang Kerja'}</Link>
            </> : <>
              <div className="registration-address"><span className="registration-status-icon"><Mail aria-hidden="true" /></span>
                <div><strong>Email perusahaan</strong><p>{registration.email}</p></div></div>
              {failed && <p className="auth-error registration-send-error" role="alert">Pengiriman gagal. Akun belum aktif.</p>}
              {sent ? <><ol className="registration-instructions"><li>Buka inbox atau folder spam.</li>
                <li>Buka email dari Ruang Kerja.</li><li>Tekan tombol Verifikasi email.</li></ol>
                <p className="registration-note registration-wait-status" role="status"><Clock3 /> Menunggu verifikasi email</p></>
                : !failed && <p>Kirim tautan verifikasi, lalu buka email dari Ruang Kerja.</p>}
              <button className={'ui-button registration-wide' + (sent ? ' ui-button--outline' : '')}
                disabled={sending || seconds > 0 || registration.sends_remaining === 0}
                onClick={() => send.mutate()}>{sending ? 'Mengirim…' : registration.delivery === 'not_sent' ? 'Kirim email verifikasi' : 'Kirim ulang email'}</button>
              <p className="registration-caption registration-next" role="status">{registration.sends_remaining === 0 ? 'Batas pengiriman tercapai. Gunakan email terbaru atau daftar kembali setelah tautan kedaluwarsa.'
                : seconds > 0 ? `Tersedia kembali dalam ${seconds} detik.` : 'Tautan berlaku 24 jam.'}</p>
              {send.error && <p className="auth-error" role="alert">{send.error instanceof ApiError ? send.error.message : 'Koneksi gagal. Periksa status sebelum mencoba kembali.'}</p>}
              {mobile ? <><button className="ui-button registration-wide" disabled>Lanjutkan</button>
                <p className="registration-caption registration-next">Aktif setelah email terverifikasi.</p></>
                : <p className="registration-caption registration-next">Registrasi selesai setelah email terverifikasi.</p>}
              <Link className="ui-button ui-button--outline registration-wide" to="/register">Sebelumnya</Link>
            </>}
    </section>
  </RegistrationShell>;
}
