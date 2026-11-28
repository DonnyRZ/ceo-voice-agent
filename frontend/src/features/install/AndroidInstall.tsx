import { ArrowLeft, Check, ExternalLink, Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { leaveInstallWait, requestInstall, retryInstallCheck, useInstallation } from './controller';

export function AndroidInstall({ step, go, complete, busy }: {
  step: string; go: (step: string) => void; complete: () => Promise<unknown>; busy: boolean;
}) {
  const installation = useInstallation();
  useEffect(() => () => leaveInstallWait(), []);
  const [manual, setManual] = useState(false);
  const waiting = installation.phase === 'prompting' || installation.phase === 'waiting';
  const installed = installation.phase === 'installed';
  const showWait = step === 'android-wait' && !installed;
  function back() { leaveInstallWait(); go('android-install'); }
  function openInstalled(event: import('react').MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (busy) return;
    const opening = window.open('about:blank', '_blank');
    if (opening) opening.opener = null;
    void complete().then(() => {
      if (opening) opening.location.replace('/launch?source=onboarding');
      else window.location.assign('/launch?source=onboarding');
    }).catch(() => opening?.close());
  }
  if (installed) return <section className="registration-card install-centered">
    <div className="install-app"><img className="install-app-icon" src="/pwa/icon-512.png" alt="Ruang Kerja" />
      <Check className="install-confirmed" aria-label="Pemasangan terdeteksi" /></div>
    <h2>Ruang Kerja</h2><p>Ruang Kerja telah terdeteksi terpasang pada perangkat ini.</p>
    <a className="ui-button install-wide" href="/launch?source=onboarding" target="_blank" rel="noopener" aria-disabled={busy}
      onClick={openInstalled}>
      Buka Ruang Kerja <ExternalLink /></a>
    <p className="registration-caption">Jika tetap terbuka di browser, ketuk ikon Ruang Kerja di layar utama.</p>
    <button className="registration-text-action" onClick={() => setManual(!manual)}>Lihat cara membuka</button>
    {manual && <p>Kembali ke layar utama Android, cari ikon Ruang Kerja, lalu ketuk ikon tersebut.</p>}
  </section>;
  if (showWait) return <section className="registration-card install-centered install-wait">
    {waiting && <div className="install-spinner" aria-hidden="true" />}
    <h2 role="status">{installation.phase === 'prompting' ? 'Selesaikan konfirmasi browser'
      : installation.phase === 'waiting' ? 'Menunggu konfirmasi pemasangan'
        : installation.phase === 'cancelled' ? 'Pemasangan dibatalkan'
          : installation.phase === 'failed' ? 'Pemasangan belum dapat dimulai' : 'Pemasangan belum terkonfirmasi'}</h2>
    <p>{waiting ? 'Setelah menyetujui pemasangan, tunggu konfirmasi dari browser.'
      : 'Browser belum memberikan bukti aplikasi siap dibuka. Anda dapat memeriksa lagi atau mengikuti panduan.'}</p>
    <p className="registration-note"><Info /> Proses pemasangan diatur oleh browser Android.</p>
    {!waiting && <button className="ui-button install-wide" onClick={retryInstallCheck}>Periksa pemasangan</button>}
    <button className="ui-button ui-button--outline install-wide" onClick={back}>Kembali ke panduan</button>
  </section>;
  return <section className="registration-card install-centered">
    <img className="install-app-icon" src="/pwa/icon-512.png" alt="Ikon Ruang Kerja" /><h2>Ruang Kerja</h2>
    <p>Akses pekerjaan langsung dari layar utama, tanpa mencari tab browser.</p>
    {!installation.nativeAvailable && <p className="registration-caption">Tombol pemasangan belum tersedia pada browser ini.
      Gunakan Chrome Android terbaru atau panduan menu browser.</p>}
    <button className="registration-text-action" onClick={() => setManual(!manual)}>Panduan pemasangan manual</button>
    {manual && <div className="registration-note"><p>Buka menu Chrome (tiga titik), pilih Tambahkan ke layar utama atau Instal aplikasi, lalu setujui konfirmasi browser.</p>
      <button className="registration-text-action" onClick={() => { retryInstallCheck(); go('android-wait'); }}>Periksa setelah memasang</button></div>}
    <p className="registration-caption">Pemasangan selalu memerlukan persetujuan Anda di browser.</p>
    <div className="registration-actions">
      <button className="ui-button ui-button--outline" onClick={() => go('device')}><ArrowLeft /> Sebelumnya</button>
      <button className="ui-button" disabled={!installation.nativeAvailable} onClick={() => { requestInstall(); go('android-wait'); }}>
        Pasang aplikasi</button>
    </div>
  </section>;
}
