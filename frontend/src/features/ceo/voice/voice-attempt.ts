import { ApiError } from '../../../shared/api';
import type { VoiceCloseReason, VoiceStage } from './voice-protocol';
import { closeVoiceSession, holdAudio, stopStream } from './voice-transport';

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
  turn: { id: string; startedAt: number; measured: boolean } | null;
  allowed: boolean;
  gateVersion: number;
}

export function newAttempt(audio: HTMLAudioElement | null): VoiceAttempt {
  return {
    signal: new AbortController(), stage: 'connecting', id: null, peer: null, audio,
    source: null, stream: null, timer: null, micMuted: false, turn: null, allowed: false, gateVersion: 0,
  };
}

export function voiceReady(attempt: VoiceAttempt) {
  return attempt.peer?.connectionState === 'connected' && (attempt.stage === 'active' || attempt.stage === 'standby');
}

export function applyMicGate(attempt: VoiceAttempt) {
  const enabled = !attempt.micMuted && voiceReady(attempt);
  for (const track of attempt.stream?.getAudioTracks() ?? []) track.enabled = enabled;
}

export function sealPlayback(attempt: VoiceAttempt, audio: HTMLAudioElement | null) {
  attempt.allowed = false;
  attempt.gateVersion += 1;
  holdAudio(audio);
}

export function clearHandshakeTimer(attempt: VoiceAttempt) {
  if (attempt.timer !== null) window.clearTimeout(attempt.timer);
  attempt.timer = null;
}

export function endAttempt(attempt: VoiceAttempt) {
  const { audio } = attempt;
  sealPlayback(attempt, audio);
  attempt.signal.abort();
  clearHandshakeTimer(attempt);
  attempt.source?.close();
  attempt.peer?.close();
  stopStream(attempt.stream);
  if (audio) audio.srcObject = null;
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
