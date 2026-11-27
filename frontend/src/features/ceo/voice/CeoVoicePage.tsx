import { LoaderCircle, Mic, MicOff, RotateCcw, Square, Volume2, WifiOff } from 'lucide-react';
import { VoiceReference } from './VoiceReference';
import { useVoiceHarness } from './useVoiceHarness';
import './ceo-voice.css';

export function CeoVoicePage() {
  const voice = useVoiceHarness();
  const { view } = voice;
  const active = view.stage === 'active' || view.stage === 'standby';
  const open = active || view.stage === 'connecting';
  const facts = view.result?.kind === 'facts' ? view.result.facts : undefined;
  const state = view.stage === 'active' ? (view.micMuted ? 'muted' : view.phase) : view.stage;
  const labels: Record<string, string> = {
    idle: 'Siap untuk ngobrol', connecting: 'Menghubungkan', listening: 'Mendengarkan',
    searching: 'Mencari informasi', answering: 'Menjawab', muted: 'Mikrofon dibisukan',
    standby: 'Mikrofon aktif', closed: 'Sesi selesai', unavailable: 'Koneksi terputus',
  };
  const hints: Record<string, string> = {
    idle: 'Mikrofon belum aktif', connecting: 'Menyiapkan sesi suara Anda…',
    listening: 'Silakan tanyakan progres pekerjaan.', searching: 'Memeriksa catatan timesheet.',
    answering: 'Sesi voice agent sedang berlangsung.', muted: 'Aktifkan mikrofon untuk berbicara.',
    standby: view.micMuted ? 'Aktifkan mikrofon untuk melanjutkan.' : 'Bicara untuk melanjutkan',
    closed: 'Mikrofon sudah tidak aktif.', unavailable: 'Mulai kembali untuk melanjutkan percakapan.',
  };
  const Icon = state === 'unavailable' ? WifiOff : state === 'searching' || state === 'connecting'
    ? LoaderCircle : state === 'answering' ? Volume2 : view.micMuted ? MicOff : Mic;

  return (
    <div className="ceo-voice-page">
      <h1 className="page-title">Voice Agent</h1>
      <div className={`ceo-voice-content${facts ? ' ceo-voice-content--facts' : ''}`}>
        <section className={`ceo-voice-stage ceo-voice-stage--${state}`} aria-label="Sesi suara">
          <div className="ceo-voice-visual" aria-hidden="true">
            {active && <span className="ceo-voice-waves"><i /><i /><i /><i /></span>}
            <span className="ceo-voice-orb"><Icon className={state === 'searching' || state === 'connecting' ? 'ceo-voice-spin' : ''} /></span>
            {active && <span className="ceo-voice-waves"><i /><i /><i /><i /></span>}
          </div>
          {view.stage === 'standby' && <span className="ceo-voice-standby">Standby</span>}
          <h2 role="status">{labels[state]}</h2>
          <p className="ceo-voice-hint">{hints[state]}</p>
          {view.error && <p role="alert" className="ceo-voice-error">{view.error}</p>}
          <div className="ceo-voice-actions">
            {active && <button className="ui-button ceo-voice-secondary" type="button" onClick={voice.toggleMic}
              aria-label={view.micMuted ? 'Aktifkan mikrofon' : 'Bisukan mikrofon'} aria-pressed={view.micMuted}>
              {view.micMuted ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}
              {view.micMuted ? 'Aktifkan' : 'Bisukan'}
            </button>}
            {open ? <button className="ui-button" type="button" onClick={voice.end}>
              <Square aria-hidden="true" />Akhiri sesi
            </button> : <button className="ui-button ceo-voice-start" type="button" onClick={() => void voice.start()}>
              {view.stage === 'unavailable' || view.stage === 'closed' ? <RotateCcw aria-hidden="true" /> : <Mic aria-hidden="true" />}
              {view.stage === 'idle' ? 'Mulai ngobrol' : 'Mulai lagi'}
            </button>}
          </div>
          {view.playbackBlocked && <button className="ui-button ceo-voice-secondary" type="button" onClick={() => void voice.playAllowed()}>
            <Volume2 aria-hidden="true" />Putar audio
          </button>}
          <audio ref={voice.audioRef} muted onPlaying={voice.markPlaying} onEnded={voice.markEnded} />
        </section>
        {facts ? <VoiceReference facts={facts} last={view.stage === 'standby' || view.stage === 'closed'} /> : view.result && (
          <section className="ceo-voice-result" role="status"><h2>{view.result.kind === 'clarify' ? 'Perlu diperjelas' : 'Informasi timesheet'}</h2>
            <p>{view.result.text}</p>
          </section>
        )}
      </div>
    </div>
  );
}
