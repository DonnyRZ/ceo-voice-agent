import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { registrationQuery } from '../registration/api';
import { RegistrationShell } from '../registration/RegistrationShell';
import { AndroidInstall } from './AndroidInstall';
import { IphoneGuide } from './IphoneGuide';
import { useInstallation } from './controller';
import { isStandalone } from './evidence';
import './install.css';

const steps = ['device', 'android-install', 'android-wait', 'iphone-share', 'iphone-add', 'iphone-open', 'done'];
export function OnboardingPage() {
  const current = useQuery(registrationQuery);
  const installation = useInstallation();
  const [parameters, setParameters] = useSearchParams();
  const requested = parameters.get('step') ?? 'device';
  const step = steps.includes(requested) ? requested : 'device';
  const [platform, setPlatform] = useState('');
  const registration = current.data?.registration;
  const iphone = step.startsWith('iphone');
  const android = step.startsWith('android');
  function go(next: string) { setParameters(next === 'device' ? {} : { step: next }); window.scrollTo(0, 0); }
  const waiting = ['prompting', 'waiting'].includes(installation.phase);
  const title = android && installation.phase === 'installed' ? 'Aplikasi siap dibuka' : step === 'device' ? 'Pilih perangkat Anda' : iphone ? 'Pasang di iPhone'
    : step === 'android-wait' ? waiting ? 'Menunggu pemasangan' : 'Pemasangan Android' : step === 'done' ? 'Panduan selesai' : 'Pasang di Android';
  return <RegistrationShell step={step === 'device' ? 2 : 3} title={title}
    subtitle={step === 'device' ? 'Di perangkat apa Anda akan menggunakan Ruang Kerja?'
      : android && installation.phase === 'installed' ? 'Ruang Kerja terpasang di perangkat Anda.' : step === 'android-wait' && !waiting ? 'Periksa hasil pemasangan atau kembali ke panduan.' : iphone ? 'Ikuti panduan melalui Safari.' : step === 'done' ? 'Buka Ruang Kerja melalui ikon aplikasi.' : 'Selesaikan konfirmasi di browser Anda.'}>
    {current.isPending ? <section className="registration-card" role="status">Memeriksa pendaftaran…</section>
      : current.error ? <section className="registration-card" role="alert">Pendaftaran belum dapat diperiksa.
        <button className="registration-text-action" onClick={() => void current.refetch()}>Coba lagi</button></section>
        : !registration ? <section className="registration-card"><p>Selesaikan data akun terlebih dahulu pada browser ini.</p>
          <Link className="ui-button" to="/register">Data akun</Link></section> : <>
          {!registration.verified && <p className="registration-note">Akun belum aktif. <Link to="/register/check-email">
            {registration.delivery === 'failed' ? 'Coba kirim ulang email verifikasi.' : 'Verifikasi email perusahaan Anda.'}</Link></p>}
          {isStandalone() ? <section className="registration-card"><h2>Aplikasi sudah terbuka</h2>
            <p>Anda menggunakan Ruang Kerja sebagai aplikasi.</p><Link className="ui-button" to="/login">Lanjutkan ke Masuk</Link></section>
            : step === 'device' ? <section className="registration-card">
              <div className="install-platforms" role="radiogroup" aria-label="Perangkat">
                {['Android', 'iPhone'].map((name) => <label key={name}
                  className={'install-platform' + (platform === name ? ' selected' : '')}>
                  <input type="radio" name="platform" aria-label={name} value={name} checked={platform === name} onChange={() => setPlatform(name)} />
                  <Smartphone aria-hidden="true" /><strong>{name}</strong>
                  <span>{name === 'Android' ? 'Pasang lewat browser' : 'Panduan melalui Safari'}</span>
                  </label>)}
              </div>
              <div className="registration-actions"><Link className="ui-button ui-button--outline" to="/register"><ArrowLeft /> Sebelumnya</Link>
                <button className="ui-button" disabled={!platform} onClick={() => go(platform === 'Android' ? 'android-install' : 'iphone-share')}>Lanjutkan <ArrowRight /></button></div>
            </section> : android ? <AndroidInstall step={step} go={go} />
              : iphone ? <IphoneGuide step={step} go={go} />
                : <section className="registration-card"><h2>Buka melalui ikon Ruang Kerja</h2>
                  <p>Pemasangan dan pembukaan aplikasi dilakukan dari perangkat Anda.</p>
                  <Link className="ui-button" to="/login">Masuk lewat browser</Link>
                  <button className="registration-text-action" onClick={() => go('device')}>Lihat panduan lagi</button></section>}
        </>}
  </RegistrationShell>;
}
