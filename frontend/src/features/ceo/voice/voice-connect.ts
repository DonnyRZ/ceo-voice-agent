import { monitorVoiceActivity } from './voice-activity';
import {
  applyMicGate, microphoneFailure, voiceFailure, type VoiceAttempt,
} from './voice-attempt';
import type { VoiceStage } from './voice-protocol';
import { closeVoiceSession, gatherOffer, openVoiceEvents, startVoiceSession, stopStream } from './voice-transport';

interface ConnectionHandlers {
  current(): boolean;
  close(stage: VoiceStage, error?: string): void;
  speech(): void;
  sync(): void;
  event(data: unknown): void;
}

/** Owns browser media setup; the caller remains the authority for the active attempt. */
export async function connectVoiceAttempt(attempt: VoiceAttempt, handlers: ConnectionHandlers) {
  const { current, close } = handlers;
  try {
    const activity = monitorVoiceActivity(handlers.speech);
    attempt.activity = activity;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true }, video: false });
    if (!current()) {
      stopStream(stream);
      return;
    }
    attempt.stream = stream;
    applyMicGate(attempt);
    const tracks = stream.getAudioTracks();
    if (tracks.length === 0) {
      close('unavailable', 'Mikrofon tidak ditemukan.');
      return;
    }
    for (const track of tracks) track.addEventListener('ended', () => {
      if (current()) close('unavailable', 'Mikrofon terputus.');
    }, { once: true });
    activity.attach(stream);
    await activity.ready;
    if (!current()) return;
  } catch (error) {
    if (current()) close('unavailable', microphoneFailure(error));
    return;
  }

  attempt.timer = window.setTimeout(() => {
    if (current()) close('unavailable', 'Waktu sambungan suara habis. Coba mulai lagi.');
  }, 25_000);

  try {
    const peer = new RTCPeerConnection();
    attempt.peer = peer;
    peer.ontrack = ({ track }) => {
      if (track.kind === 'audio') track.enabled = false;
    };
    peer.onconnectionstatechange = () => {
      if (!current()) return;
      if (['closed', 'failed', 'disconnected'].includes(peer.connectionState)) {
        close('unavailable', 'Sesi suara terputus. Coba mulai lagi.');
      }
      if (peer.connectionState === 'connected') handlers.sync();
    };
    peer.createDataChannel('oai-events');
    const stream = attempt.stream;
    if (stream) for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);

    const sdp = await gatherOffer(peer, attempt.signal.signal);
    if (!current()) return;
    const session = await startVoiceSession(sdp);
    if (!current()) {
      if (session?.id) closeVoiceSession(session.id);
      return;
    }
    attempt.id = typeof session?.id === 'string' ? session.id : null;
    if (!attempt.id || typeof session?.sdp !== 'string' || !session.sdp) throw new Error('Invalid SDP answer');
    const source = openVoiceEvents(attempt.id);
    attempt.source = source;
    source.onmessage = ({ data }) => handlers.event(data);
    source.onerror = () => {
      if (current()) close('unavailable', 'Sambungan status suara terputus. Coba mulai lagi.');
    };
    await peer.setRemoteDescription({ type: 'answer', sdp: session.sdp });
  } catch (error) {
    if (current()) close('unavailable', voiceFailure(error));
  }
}
