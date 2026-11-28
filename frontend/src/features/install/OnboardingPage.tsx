import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { registrationQuery } from '../registration/api';
import { RegistrationShell } from '../registration/RegistrationShell';
import { AndroidInstall } from './AndroidInstall';
import { IphoneGuide } from './IphoneGuide';
import { useInstallation } from './controller';
import { isStandalone } from './evidence';
import { useOnboardingProgress } from './progress';
import { ApiError } from '../../shared/api';
import './install.css';

const steps = ['device', 'android-install', 'android-wait', 'iphone-share', 'iphone-add', 'iphone-open', 'done'];
export function OnboardingPage() {
  const current = useQuery(registrationQuery);
  const installation = useInstallation();
  const progress = useOnboardingProgress();
  const [parameters, setParameters] = useSearchParams();
  const [guideStep, setGuideStep] = useState<string | null>(null);
  const requested = current.data?.registration?.completed && guideStep ? guideStep
    : current.data?.registration?.step ?? parameters.get('step') ?? 'device';
  const step = requested === 'done' && !current.data?.registration?.completed ? current.data?.registration?.step ?? 'device'
    : steps.includes(requested) ? requested : 'device';
  const [platform, setPlatform] = useState('');
  const registration = current.data?.registration;
  const iphone = step.startsWith('iphone');
  const android = step.startsWith('android');
  async function go(next: string) {
    if (progress.busy) return;
    if (registration?.completed) { setGuideStep(next); window.scrollTo(0, 0); return; }
    try {
      if (next === 'done') await progress.complete.mutateAsync('iphone-confirmed');
      else await progress.save.mutateAsync(next);
      setParameters(next === 'device' ? {} : { step: next }); window.scrollTo(0, 0);
    } catch { /* Keep the current step and expose the save error below. */ }
  }
  const waiting = ['prompting', 'waiting'].includes(installation.phase);
  const title = android && installation.phase === 'installed' ? 'Aplikasi siap dibuka' : step === 'device' ? 'Pilih perangkat Anda' : iphone ? 'Pasang di iPhone'
    : step === 'android-wait' ? waiting ? 'Menunggu pemasangan' : 'Pemasangan Android' : step === 'done' ? 'Panduan selesai' : 'Pasang di Android';
  if (registration && (!registration.verified || registration.origin_device === 'desktop')) {
    return <Navigate to="/register/check-email" replace />;
  }
  return <RegistrationShell step={registration?.completed ? 5 : step === 'device' ? 3 : 4} flow="mobile" title={title}
    subtitle={step === 'device' ? 'Di perangkat apa Anda akan menggunakan Ruang Kerja?'
      : android && installation.phase === 'installed' ? 'Ruang Kerja terpasang di perangkat Anda.' : step === 'android-wait' && !waiting ? 'Periksa hasil pemasangan atau kembali ke panduan.' : iphone ? 'Ikuti panduan melalui Safari.' : step === 'done' ? 'Buka Ruang Kerja melalui ikon aplikasi.' : 'Selesaikan konfirmasi di browser Anda.'}>
    {current.isPending ? <section className="registration-card" role="status">Memeriksa pendaftaran…</section>
      : current.error ? <section className="registration-card" role="alert">Pendaftaran belum dapat diperiksa.
        <button className="registration-text-action" onClick={() => void current.refetch()}>Coba lagi</button></section>
        : !registration ? <section className="registration-card"><p>Selesaikan data akun terlebih dahulu pada browser ini.</p>
          <Link className="ui-button" to="/register">Data akun</Link></section> : <>
          {isStandalone() ? <section className="registration-card"><h2>Aplikasi sudah terbuka</h2>
            <p>Anda menggunakan Ruang Kerja sebagai aplikasi.</p><button className="ui-button" disabled={progress.busy}
              onClick={() => void progress.complete.mutateAsync('standalone').then(() => { window.location.href='/login'; }).catch(() => {})}>Lanjutkan ke Masuk</button></section>
            : step === 'device' ? <section className="registration-card">
              <div className="install-platforms" role="radiogroup" aria-label="Perangkat">
                {['Android', 'iPhone'].map((name) => <label key={name}
                  className={'install-platform' + (platform === name ? ' selected' : '')}>
                  <input type="radio" name="platform" aria-label={name} value={name} checked={platform === name} onChange={() => setPlatform(name)} />
                  <Smartphone aria-hidden="true" /><strong>{name}</strong>
                  <span>{name === 'Android' ? 'Pasang lewat browser' : 'Panduan melalui Safari'}</span>
                  </label>)}
              </div>
              <p className="registration-note">Email Anda sudah terverifikasi.</p>
              <div className="registration-actions"><Link className="ui-button ui-button--outline" to="/register/check-email"><ArrowLeft /> Sebelumnya</Link>
                <button className="ui-button" disabled={!platform || progress.busy} onClick={() => void go(platform === 'Android' ? 'android-install' : 'iphone-share')}>Lanjutkan <ArrowRight /></button></div>
            </section> : android ? <AndroidInstall step={step} go={go} complete={() => progress.complete.mutateAsync('android-installed')} busy={progress.busy} />
              : iphone ? <IphoneGuide step={step} go={go} busy={progress.busy} />
                : <section className="registration-card"><h2>Buka melalui ikon Ruang Kerja</h2>
                  <p>Pemasangan dan pembukaan aplikasi dilakukan dari perangkat Anda.</p>
                  <Link className="ui-button" to="/login">Masuk lewat browser</Link>
                  <button className="registration-text-action" onClick={() => go('device')}>Lihat panduan lagi</button></section>}
        </>}
    {progress.error && <p className="auth-error" role="alert">{progress.error instanceof ApiError
      ? progress.error.message : 'Progres belum dapat disimpan. Coba lagi pada langkah ini.'}</p>}
  </RegistrationShell>;
}
