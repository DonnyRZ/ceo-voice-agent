import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Clock3, Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../shared/api';
import { registrationQuery, type Registration } from './api';
import { RegistrationShell } from './RegistrationShell';
import { clearRegistrationDraft } from './draft';

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
  const mobile = !!registration && registration.origin_device !== 'desktop';
  const completed = registration?.completed === true;
  const verified = registration?.verified === true;
  useEffect(() => { if (registration?.completed) clearRegistrationDraft(); }, [registration?.completed]);
  const sent = registration?.delivery === 'sent';
  const failed = registration?.delivery === 'failed';
  const seconds = Math.max(0, Math.ceil((registration?.retry_after_seconds ?? 0) - Math.max(0, now - current.dataUpdatedAt) / 1000));
  const sending = send.isPending || (registration?.delivery === 'pending' && seconds > 0);
  const title = completed ? 'Registrasi selesai' : verified ? 'Email terverifikasi'
    : failed ? 'Email belum terkirim' : sent ? 'Periksa email Anda' : 'Verifikasi email';
  return <RegistrationShell step={completed ? 5 : verified ? 3 : 2} flow={mobile ? 'mobile' : 'desktop'} joined showSteps={!!registration?.origin_device}
    icon={verified ? Check : Mail} title={title}
    subtitle={completed ? 'Email perusahaan Anda sudah terverifikasi.'
      : verified ? mobile ? 'Lanjutkan untuk menyiapkan aplikasi di HP Anda.' : 'Kembali ke browser tempat Anda mendaftar.'
        : failed ? 'Data akun tersimpan. Coba kirim email kembali.'
          : sent ? 'Tautan verifikasi sudah dikirim.' : mobile ? 'Verifikasi email sebelum menyiapkan aplikasi.' : 'Satu langkah lagi untuk mengaktifkan akun Anda.'}>
    <section className="registration-card registration-email-card">
      {current.isPending ? <p role="status"><span className="loading-inline"><span className="ui-spinner" aria-hidden="true" />Memeriksa pendaftaran</span></p>
        : current.error ? <><p role="alert">Pendaftaran belum dapat diperiksa.</p>
          <button className="ui-button" onClick={() => void current.refetch()}>Coba lagi</button></>
          : !registration ? <><p>Tidak ada pendaftaran aktif pada browser ini. Gunakan browser tempat Anda mendaftar.</p>
            <Link className="ui-button" to="/register">Daftar kembali</Link></>
            : verified ? <>
              <div className="registration-verified"><span className="registration-status-icon"><Check aria-hidden="true" /></span>
                <div><h2>{completed ? 'Akun Anggota Divisi Anda sudah aktif.' : 'Email Anda sudah terverifikasi.'}</h2>
                  <p>{completed ? 'Masuk menggunakan email dan kata sandi yang Anda daftarkan.' : 'Proses penyiapan aplikasi belum selesai.'}</p></div></div>
              {!completed && <p className="registration-note"><strong>Berikutnya:</strong> pilih Android atau iPhone, lalu ikuti panduan pemasangan.</p>}
              <Link className="ui-button registration-wide" to={completed ? '/login' : '/onboarding'}>
                {completed ? 'Masuk ke Ruang Kerja' : <>Lanjutkan <ArrowRight /></>}</Link>
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
                onClick={() => send.mutate()}>{sending ? <span className="loading-inline" aria-live="polite"><span className="ui-spinner" aria-hidden="true" />Mengirim</span> : registration.delivery === 'not_sent' ? 'Kirim email verifikasi' : 'Kirim ulang email'}</button>
              <p className="registration-caption registration-next" role="status">{registration.sends_remaining === 0 ? 'Batas pengiriman tercapai. Gunakan email terbaru atau daftar kembali setelah tautan kedaluwarsa.'
                : seconds > 0 ? `Tersedia kembali dalam ${seconds} detik.` : 'Tautan berlaku 24 jam.'}</p>
              {send.error && <p className="auth-error" role="alert">{send.error instanceof ApiError ? send.error.message : 'Koneksi gagal. Periksa status sebelum mencoba kembali.'}</p>}
              <p className="registration-caption registration-next">{mobile
                ? 'Tombol Lanjutkan aktif setelah email terverifikasi.' : 'Registrasi selesai setelah email terverifikasi.'}</p>
              <div className="registration-actions">
                <Link className="ui-button ui-button--outline" to="/register?edit=1">Sebelumnya</Link>
                {mobile && <button className="ui-button" disabled>Lanjutkan</button>}
              </div>
            </>}
    </section>
  </RegistrationShell>;
}
