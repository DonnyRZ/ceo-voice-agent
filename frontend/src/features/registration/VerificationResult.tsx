import { Check, Monitor, Smartphone } from 'lucide-react';
import { Link } from 'react-router-dom';
import { RegistrationShell } from './RegistrationShell';

export function VerificationResult({ origin }: { origin: 'mobile' | 'desktop' | null }) {
  const mobile = origin === 'mobile';
  const desktop = origin === 'desktop';
  return <RegistrationShell joined showSteps={false} icon={Check}
    title={desktop ? 'Registrasi selesai' : 'Email terverifikasi'}
    subtitle={desktop ? 'Email perusahaan Anda sudah terverifikasi.' : mobile ? 'Lanjutkan pendaftaran di HP Anda.' : 'Kembali ke browser tempat Anda mendaftar.'}>
    <section className="registration-card registration-email-card">
      <div className="registration-verified"><span className="registration-status-icon"><Check /></span>
        <div><h2>{mobile ? 'Kembali ke HP tempat Anda mendaftar' : desktop ? 'Akun Anggota Divisi Anda sudah aktif.' : 'Verifikasi email berhasil.'}</h2>
          <p>{mobile ? 'Buka kembali halaman pendaftaran pada HP dan browser yang sama. Tombol Lanjutkan sudah aktif di sana.'
            : desktop ? 'Pendaftaran dimulai di komputer. Kembali ke komputer untuk masuk ke Ruang Kerja.'
              : 'Periksa status dan lanjutkan proses dari halaman pendaftaran asal.'}</p></div></div>
      <p className="registration-note registration-return"><span>{desktop ? <Monitor /> : <Smartphone />}</span>
        {mobile ? 'Lanjutkan dari langkah Verifikasi, lalu pilih Android atau iPhone.'
          : desktop ? 'Tidak perlu melakukan pemasangan untuk menyelesaikan registrasi desktop.' : 'Gunakan browser yang dipakai untuk mengisi data akun.'}</p>
      {desktop ? <Link className="ui-button registration-wide" to="/login">Masuk ke Ruang Kerja</Link>
        : mobile ? <p className="registration-next registration-caption">Halaman ini dapat ditutup.</p>
          : <><Link className="ui-button registration-wide" to="/register/check-email">Periksa pendaftaran</Link>
            <Link className="ui-button ui-button--outline registration-wide" to="/login">Masuk ke Ruang Kerja</Link></>}
    </section>
  </RegistrationShell>;
}
