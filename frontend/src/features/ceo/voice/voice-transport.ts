import {
  maximumVoiceWavBytes, voicePcmBytesPerSample, voicePcmSampleRate, voiceWavHeaderBytes,
} from '../../../../../shared/voice-pcm';
import { api } from '../../../shared/api';

const sessionsPath = '/api/ceo/voice/sessions';

const sessionPath = (id: string) => `${sessionsPath}/${encodeURIComponent(id)}`;

export async function startVoiceSession(sdp: string) {
  return api<{ id: string; sdp: string }>(sessionsPath, {
    method: 'POST',
    body: JSON.stringify({ sdp }),
  });
}

export const openVoiceEvents = (id: string) => new EventSource(`${sessionPath(id)}/events`);

export function closeVoiceSession(id: string) {
  void fetch(sessionPath(id), { method: 'DELETE', credentials: 'same-origin', keepalive: true }).catch(() => undefined);
}

export function reportBrowserPlayback(id: string, turnId: string, generation: number, elapsedMs: number) {
  void api<void>(sessionPath(id) + '/telemetry', {
    method: 'POST', body: JSON.stringify({ turnId, generation, elapsedMs }),
  }).catch(() => undefined);
}

function pcmWave(bytes: Uint8Array<ArrayBuffer>) {
  if (bytes.length <= voiceWavHeaderBytes || bytes.length % voicePcmBytesPerSample !== 0) return false;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return data.getUint32(0) === 0x52494646 && data.getUint32(4, true) === bytes.length - 8
    && data.getUint32(8) === 0x57415645 && data.getUint32(12) === 0x666d7420 && data.getUint32(16, true) === 16
    && data.getUint16(20, true) === 1 && data.getUint16(22, true) === 1 && data.getUint32(24, true) === voicePcmSampleRate
    && data.getUint32(28, true) === voicePcmSampleRate * voicePcmBytesPerSample
    && data.getUint16(32, true) === voicePcmBytesPerSample && data.getUint16(34, true) === voicePcmBytesPerSample * 8
    && data.getUint32(36) === 0x64617461 && data.getUint32(40, true) === bytes.length - voiceWavHeaderBytes;
}

export async function fetchVoiceAudio(id: string, turnId: string, generation: number, signal: AbortSignal) {
  const path = `${sessionPath(id)}/turns/${encodeURIComponent(turnId)}/audio?generation=${generation}`;
  const response = await fetch(path, {
    credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Accept: 'audio/wav' }, signal,
  });
  if (!response.ok || !response.body || response.headers.get('Content-Type')?.split(';')[0].trim() !== 'audio/wav') {
    void response.body?.cancel().catch(() => undefined);
    throw new Error('Invalid verified audio response');
  }
  const reader = response.body.getReader();
  const bytes = new Uint8Array(maximumVoiceWavBytes);
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > maximumVoiceWavBytes) {
        void reader.cancel().catch(() => undefined);
        throw new Error('Verified audio exceeds playback limit');
      }
      bytes.set(value, length);
      length += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  signal.throwIfAborted();
  const wav = bytes.subarray(0, length);
  if (!pcmWave(wav)) throw new Error('Invalid verified PCM audio');
  return new Blob([wav], { type: 'audio/wav' });
}

function waitForIce(peer: RTCPeerConnection, signal: AbortSignal) {
  signal.throwIfAborted();
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error('ICE gathering timed out')), 8000);
    const abort = () => finish(signal.reason);
    const check = () => { if (peer.iceGatheringState === 'complete') finish(); };
    const finish = (error?: unknown) => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      peer.removeEventListener('icegatheringstatechange', check);
      if (error) reject(error);
      else resolve();
    };
    signal.addEventListener('abort', abort, { once: true });
    peer.addEventListener('icegatheringstatechange', check);
    check();
  });
}

export async function gatherOffer(peer: RTCPeerConnection, signal: AbortSignal) {
  const offer = await peer.createOffer();
  signal.throwIfAborted();
  await peer.setLocalDescription(offer);
  await waitForIce(peer, signal);
  signal.throwIfAborted();
  const sdp = peer.localDescription?.sdp;
  if (!sdp) throw new Error('Missing local SDP');
  return sdp;
}

export function stopStream(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

export function holdAudio(audio: HTMLAudioElement | null) {
  if (!audio) return;
  audio.muted = true;
  audio.pause();
}
