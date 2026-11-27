import { Mic, MicOff, Square, Volume2 } from 'lucide-react';
import { VoiceReference } from './VoiceReference';
import { useVoiceHarness } from './useVoiceHarness';
import type { VoiceResult, VoiceStage } from './voice-protocol';
import './ceo-voice.css';

const stageLabel: Record<VoiceStage, string> = {
  idle: 'Siap memulai',
  connecting: 'Menghubungkan',
  active: 'Sesi aktif',
  standby: 'Siaga',
  closed: 'Sesi berakhir',
  unavailable: 'Sesi tidak tersedia',
};

const resultLabel: Record<VoiceResult['kind'], string> = {
  facts: 'Rujukan tersedia',
  clarify: 'Perlu klarifikasi',
  no_match: 'Timesheet yang sesuai belum ditemukan.',
  unsupported: 'Pertanyaan di luar cakupan timesheet.',
  unavailable: 'Timesheet belum bisa diperiksa.',
};

export function CeoVoicePage() {
  const voice = useVoiceHarness();
  const { view } = voice;
  const canMute = view.stage === 'active' || view.stage === 'standby';
  const open = canMute || view.stage === 'connecting';
  const facts = view.result?.kind === 'facts' ? view.result.facts : undefined;

  return (
    <div className="ceo-voice-page">
      <header className="ceo-voice-heading"><h1 className="page-title">Uji Voice Agent CEO</h1></header>
      <section className="ceo-voice-card" aria-labelledby="voice-session-title">
        <h2 id="voice-session-title"><Mic aria-hidden="true" />Sesi suara</h2>
        <p role="status" className="ceo-voice-status">{stageLabel[view.stage]}</p>
        {view.error && <p role="alert" className="ceo-voice-error">{view.error}</p>}
        <div className="ceo-voice-actions">
          {open ? (
            <>
              <button className="ui-button ceo-voice-end" type="button" onClick={voice.end}>
                <Square aria-hidden="true" />Akhiri sesi
              </button>
              {canMute && (
                <button className="ui-button ceo-voice-secondary" type="button" onClick={voice.toggleMic}>
                  {view.micMuted ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}
                  {view.micMuted ? 'Aktifkan mikrofon' : 'Bisukan mikrofon'}
                </button>
              )}
            </>
          ) : <button className="ui-button" type="button" onClick={() => void voice.start()}>
            <Mic aria-hidden="true" />Mulai sesi
          </button>}
          {view.playbackBlocked && (
            <button className="ui-button ceo-voice-secondary" type="button" onClick={() => void voice.playAllowed()}>
              <Volume2 aria-hidden="true" />Putar audio
            </button>
          )}
        </div>
        {view.timingMs !== undefined && <p className="ceo-voice-muted">Giliran ke pemutaran browser {view.timingMs} ms</p>}
        <audio ref={voice.audioRef} muted onPlaying={voice.markPlaying} />
      </section>
      {facts ? <VoiceReference facts={facts} /> : view.result && (
        <p className="ceo-voice-card ceo-voice-result" role="status">{resultLabel[view.result.kind]}</p>
      )}
    </div>
  );
}
