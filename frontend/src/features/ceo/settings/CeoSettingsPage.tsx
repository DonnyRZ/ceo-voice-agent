import { ArrowLeft, Globe2, Volume2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCeoPreferences } from './preferences';
import './ceo-settings.css';

export function CeoSettingsPage() {
  const { playVoiceAnswers, setPlayVoiceAnswers } = useCeoPreferences();
  const [feedback, setFeedback] = useState('');
  const [failed, setFailed] = useState(false);

  function togglePlayback() {
    try {
      setPlayVoiceAnswers(!playVoiceAnswers);
      setFailed(false);
      setFeedback('Pengaturan suara tersimpan di perangkat ini.');
    } catch {
      setFailed(true);
      setFeedback('Pengaturan belum tersimpan. Periksa izin penyimpanan browser, lalu coba lagi.');
    }
  }

  return (
    <section className="ceo-settings-page" aria-labelledby="ceo-settings-title">
      <h1 id="ceo-settings-title" className="page-title">Pengaturan</h1>
      <Link className="ceo-account-back" to="/ceo/account"><ArrowLeft aria-hidden="true" />Akun</Link>
      <div className="ceo-settings-panel">
        <section className="ceo-setting" aria-labelledby="language-title">
          <div className="ceo-setting-heading">
            <Globe2 aria-hidden="true" />
            <div><h2 id="language-title">Bahasa</h2><p>Bahasa yang digunakan di Ruang Kerja.</p></div>
          </div>
          <div className="ceo-setting-control ceo-language-control">
            <p>Bahasa Indonesia</p>
            <span>Bahasa aplikasi saat ini</span>
          </div>
        </section>
        <section className="ceo-setting" aria-labelledby="sound-title">
          <div className="ceo-setting-heading">
            <Volume2 aria-hidden="true" />
            <div><h2 id="sound-title">Suara</h2><p>Putar jawaban suara dari agent.</p></div>
          </div>
          <div className="ceo-setting-control">
            <label htmlFor="ceo-voice-playback">Putar jawaban suara</label>
            <button id="ceo-voice-playback" type="button" className="ceo-setting-switch" role="switch"
              aria-checked={playVoiceAnswers} aria-label="Putar jawaban suara"
              aria-describedby="ceo-playback-note" onClick={togglePlayback}>
              <span />
            </button>
          </div>
        </section>
      </div>
      <p id="ceo-playback-note" className="ceo-settings-note">
        Pengaturan suara berlaku untuk akun Anda di browser ini. Mikrofon dan kartu fakta tetap tersedia saat suara dimatikan.
      </p>
      {feedback && <p className={failed ? 'ceo-account-error' : 'ceo-account-feedback'} role={failed ? 'alert' : 'status'}>{feedback}</p>}
    </section>
  );
}
