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

export function reportBrowserPlayback(id: string, elapsedMs: number) {
  void api<void>(sessionPath(id) + '/telemetry', {
    method: 'POST', body: JSON.stringify({ elapsedMs }),
  }).catch(() => undefined);
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
