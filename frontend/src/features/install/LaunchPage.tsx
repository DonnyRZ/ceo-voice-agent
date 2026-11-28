import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { sessionQuery } from '../../shared/session';
import { loginDestination } from '../auth/login-destination';
import { RegistrationShell } from '../registration/RegistrationShell';
import { isStandalone } from './evidence';
import { registrationQuery } from '../registration/api';
import { registrationDestination } from '../registration/destination';
import './install.css';

export function LaunchPage() {
  const standalone = isStandalone();
  const session = useQuery({ ...sessionQuery, enabled: standalone });
  const needsProgress = standalone && session.isSuccess && !session.data;
  const progress = useQuery({ ...registrationQuery, enabled: needsProgress });
  if (standalone && (session.isPending || (needsProgress && progress.isPending))) return <main className="session-status" role="status">Membuka Ruang Kerja…</main>;
  if (standalone && (session.error || (needsProgress && progress.error))) return <main className="session-status"><section className="load-problem">
    <h1>Sesi tidak dapat diperiksa</h1><p>Periksa koneksi internet, lalu coba lagi.</p>
    <button className="ui-button" onClick={() => { if (session.error) void session.refetch(); else void progress.refetch(); }}>Coba lagi</button>
  </section></main>;
  if (needsProgress && progress.data?.registration && !progress.data.registration.completed) {
    return <Navigate to={registrationDestination(progress.data.registration)} replace />;
  }
  if (standalone) return <Navigate to={session.data ? loginDestination(session.data, undefined) : '/login'} replace />;
  return <RegistrationShell showSteps={false} title="Buka aplikasi terpasang" subtitle="Gunakan ikon Ruang Kerja di layar utama.">
    <section className="registration-card"><p>Browser belum mengalihkan halaman ini ke aplikasi terpasang.</p>
      <p>Kembali ke layar utama perangkat Anda, cari ikon Ruang Kerja, lalu ketuk untuk membuka aplikasi.</p>
      <img className="install-app-icon" src="/pwa/icon-512.png" alt="Ikon Ruang Kerja" />
      <p>Halaman ini tidak menganggap tab browser sebagai aplikasi yang berhasil dibuka.</p>
    </section>
  </RegistrationShell>;
}
