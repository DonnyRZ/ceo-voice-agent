import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionQuery } from '../../../shared/session';
import {
  applyMicGate, clearHandshakeTimer, closeReasonMessage, endAttempt, microphoneFailure, newAttempt, sealPlayback,
  voiceFailure, voiceReady, type VoiceAttempt,
} from './voice-attempt';
import { readVoiceEvent, type VoiceResult, type VoiceStage } from './voice-protocol';
import { closeVoiceSession, gatherOffer, holdAudio, openVoiceEvents, reportBrowserPlayback, startVoiceSession, stopStream } from './voice-transport';

interface VoiceView {
  stage: VoiceStage;
  micMuted: boolean;
  playbackBlocked: boolean;
  error?: string;
  result?: VoiceResult;
  timingMs?: number;
}

const freshView = (stage: VoiceStage, error?: string): VoiceView => ({
  stage, error, micMuted: false, playbackBlocked: false,
});

export function useVoiceHarness() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const running = useRef<VoiceAttempt>(null);
  const [view, setView] = useState<VoiceView>(() => freshView('idle'));
  const cache = useQueryClient();

  const close = useCallback((next: VoiceStage, error?: string, update = true) => {
    const attempt = running.current;
    running.current = null;
    if (attempt) endAttempt(attempt);
    if (update) setView(freshView(next, error));
  }, []);

  useEffect(() => {
    function pageHide() { close('closed'); }
    window.addEventListener('pagehide', pageHide);
    return () => {
      window.removeEventListener('pagehide', pageHide);
      close('closed', undefined, false);
    };
  }, [close]);

  async function playAllowed(attempt = running.current) {
    const audio = audioRef.current;
    if (!attempt || running.current !== attempt || !attempt.allowed || attempt.stage !== 'active' || !voiceReady(attempt)
      || !audio?.srcObject) return;
    const gateVersion = attempt.gateVersion;
    audio.muted = false;
    try {
      await audio.play();
      if (running.current === attempt && attempt.gateVersion === gateVersion) {
        setView((previous) => previous.playbackBlocked ? { ...previous, playbackBlocked: false } : previous);
      }
    } catch {
      if (running.current === attempt && attempt.gateVersion === gateVersion) {
        holdAudio(audio);
        setView((previous) => ({ ...previous, playbackBlocked: true }));
      }
    }
  }

  function syncConnection(attempt: VoiceAttempt) {
    const ready = voiceReady(attempt);
    applyMicGate(attempt);
    if (ready) clearHandshakeTimer(attempt);
    setView((previous) => ({ ...previous, stage: ready ? attempt.stage : 'connecting', playbackBlocked: false }));
    if (ready) void playAllowed(attempt);
  }

  function readEvent(attempt: VoiceAttempt, data: unknown) {
    if (running.current !== attempt) return;
    const event = readVoiceEvent(data);
    if (!event) {
      close('unavailable', 'Status sesi suara tidak dapat diverifikasi.');
      return;
    }

    switch (event.type) {
      case 'state': {
        if (event.state === 'closed' || event.state === 'unavailable') {
          close(event.state, closeReasonMessage(event.reason)
            ?? (event.state === 'unavailable' ? 'Voice Agent belum tersedia.' : undefined));
          if (event.reason === 'revoked') void cache.invalidateQueries({ queryKey: sessionQuery.queryKey });
          return;
        }
        if (event.state !== 'active') sealPlayback(attempt, audioRef.current);
        attempt.stage = event.state;
        syncConnection(attempt);
        return;
      }
      case 'turn':
        sealPlayback(attempt, audioRef.current);
        attempt.turn = { id: event.turnId, startedAt: performance.now(), measured: false };
        setView((previous) => ({ ...previous, result: undefined, timingMs: undefined, playbackBlocked: false }));
        return;
      case 'result':
        if (attempt.turn?.id === event.turnId) setView((previous) => ({ ...previous, result: event.result }));
        return;
      case 'playback':
        if (attempt.turn?.id !== event.turnId) return;
        if (event.allowed) {
          attempt.allowed = true;
          void playAllowed(attempt);
        } else {
          sealPlayback(attempt, audioRef.current);
          setView((previous) => ({ ...previous, playbackBlocked: false }));
        }
    }
  }

  async function start() {
    if (running.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection !== 'function' || typeof EventSource !== 'function') {
      setView(freshView('unavailable', 'Browser ini tidak menyediakan akses mikrofon dan WebRTC.'));
      return;
    }
    const attempt = newAttempt(audioRef.current);
    running.current = attempt;
    setView(freshView('connecting'));

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (running.current !== attempt) {
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
        if (running.current === attempt) close('unavailable', 'Mikrofon terputus.');
      }, { once: true });
    } catch (error) {
      if (running.current === attempt) close('unavailable', microphoneFailure(error));
      return;
    }

    attempt.timer = window.setTimeout(() => {
      if (running.current === attempt) close('unavailable', 'Waktu sambungan suara habis. Coba mulai lagi.');
    }, 25_000);

    try {
      const peer = new RTCPeerConnection();
      attempt.peer = peer;
      peer.ontrack = ({ streams, track }) => {
        const audio = audioRef.current;
        if (running.current !== attempt || !audio || track.kind !== 'audio') return;
        holdAudio(audio);
        audio.srcObject = streams[0] ?? new MediaStream([track]);
        void playAllowed(attempt);
      };
      peer.onconnectionstatechange = () => {
        if (running.current !== attempt) return;
        if (['closed', 'failed', 'disconnected'].includes(peer.connectionState)) {
          close('unavailable', 'Sesi suara terputus. Coba mulai lagi.');
        }
        if (peer.connectionState === 'connected') syncConnection(attempt);
      };
      peer.createDataChannel('oai-events');
      const stream = attempt.stream;
      if (stream) for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);

      const sdp = await gatherOffer(peer, attempt.signal.signal);
      if (running.current !== attempt) return;
      const session = await startVoiceSession(sdp);
      if (running.current !== attempt) {
        if (session?.id) closeVoiceSession(session.id);
        return;
      }
      attempt.id = typeof session?.id === 'string' ? session.id : null;
      if (!attempt.id || typeof session?.sdp !== 'string' || !session.sdp) throw new Error('Invalid SDP answer');
      const source = openVoiceEvents(attempt.id);
      attempt.source = source;
      source.onmessage = ({ data }) => readEvent(attempt, data);
      source.onerror = () => {
        if (running.current === attempt) close('unavailable', 'Sambungan status suara terputus. Coba mulai lagi.');
      };
      await peer.setRemoteDescription({ type: 'answer', sdp: session.sdp });
    } catch (error) {
      if (running.current === attempt) close('unavailable', voiceFailure(error));
    }
  }

  function toggleMic() {
    const attempt = running.current;
    if (!attempt?.stream) return;
    attempt.micMuted = !attempt.micMuted;
    applyMicGate(attempt);
    setView((previous) => ({ ...previous, micMuted: attempt.micMuted }));
  }

  function markPlaying() {
    const attempt = running.current;
    if (!attempt?.allowed || attempt.stage !== 'active' || !voiceReady(attempt)
      || !attempt.turn || attempt.turn.measured || audioRef.current?.muted) return;
    attempt.turn.measured = true;
    const timingMs = Math.round(performance.now() - attempt.turn.startedAt);
    setView((previous) => ({ ...previous, timingMs }));
    if (attempt.id && timingMs <= 30_000) reportBrowserPlayback(attempt.id, timingMs);
  }

  return { audioRef, view, start, end: () => close('closed'), toggleMic, playAllowed, markPlaying };
}
