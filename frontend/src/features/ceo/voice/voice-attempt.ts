import { ApiError } from '../../../shared/api';
import type { VoiceCloseReason, VoiceStage } from './voice-protocol';
import { closeVoiceSession, holdAudio, stopStream } from './voice-transport';
import type { monitorVoiceActivity } from './voice-activity';

export interface VoiceTurn {
  id: string;
  generation: number;
  startedAt: number;
  measured: boolean;
  approved: boolean;
  sealed: boolean;
  playRequested: boolean;
  fetch: AbortController | null;
  objectUrl: string | null;
}

export interface VoiceAttempt {
  signal: AbortController;
  stage: VoiceStage;
  id: string | null;
  peer: RTCPeerConnection | null;
  audio: HTMLAudioElement | null;
  source: EventSource | null;
  stream: MediaStream | null;
  timer: number | null;
  micMuted: boolean;
  activity: ReturnType<typeof monitorVoiceActivity> | null;
  turn: VoiceTurn | null;
  playbackEnabled?: () => boolean;
}

export function newAttempt(audio: HTMLAudioElement | null, playbackEnabled = () => true): VoiceAttempt {
  return {
    signal: new AbortController(), stage: 'connecting', id: null, peer: null, audio,
    source: null, stream: null, timer: null, micMuted: false, activity: null, turn: null, playbackEnabled,
  };
}

export function voiceReady(attempt: VoiceAttempt) {
  return attempt.peer?.connectionState === 'connected' && (attempt.stage === 'active' || attempt.stage === 'standby');
}

export function applyMicGate(attempt: VoiceAttempt) {
  const enabled = !attempt.micMuted && voiceReady(attempt);
  for (const track of attempt.stream?.getAudioTracks() ?? []) track.enabled = enabled;
}

export function sealPlayback(attempt: VoiceAttempt) {
  if (attempt.turn) attempt.turn.sealed = true;
  stopAttemptAudio(attempt);
}

/** Mutes this answer permanently without rejecting its pending verified facts. */
export function suppressPlayback(attempt: VoiceAttempt) {
  if (attempt.turn) attempt.turn.playRequested = true;
  stopAttemptAudio(attempt);
}

function stopAttemptAudio(attempt: VoiceAttempt) {
  const { audio, turn } = attempt;
  holdAudio(audio);
  if (!turn) return;
  turn.fetch?.abort();
  turn.fetch = null;
  if (turn.objectUrl) {
    if (audio) {
      audio.removeAttribute('src');
      audio.load();
    }
    URL.revokeObjectURL(turn.objectUrl);
    turn.objectUrl = null;
  }
}

export function clearHandshakeTimer(attempt: VoiceAttempt) {
  if (attempt.timer !== null) window.clearTimeout(attempt.timer);
  attempt.timer = null;
}

export function endAttempt(attempt: VoiceAttempt) {
  sealPlayback(attempt);
  attempt.signal.abort();
  clearHandshakeTimer(attempt);
  attempt.source?.close();
  attempt.peer?.close();
  attempt.activity?.close();
  stopStream(attempt.stream);
  if (attempt.id) closeVoiceSession(attempt.id);
}

export function closeReasonMessage(reason?: VoiceCloseReason) {
  if (reason === 'revoked') return 'Akses Voice Agent CEO dicabut.';
  if (reason === 'timeout') return 'Sesi suara sudah kedaluwarsa.';
  if (reason === 'unavailable') return 'Voice Agent belum tersedia.';
  return undefined;
}

export function voiceFailure(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return 'Akses Voice Agent CEO tidak tersedia.';
    if (error.status === 503) return 'Voice Agent belum tersedia.';
  }
  return 'Sesi suara tidak dapat terhubung. Coba mulai lagi.';
}

export function microphoneFailure(error: unknown) {
  if (error instanceof Error) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Izin mikrofon ditolak.';
    if (error.name === 'NotFoundError') return 'Mikrofon tidak ditemukan.';
  }
  return 'Mikrofon tidak dapat digunakan.';
}
