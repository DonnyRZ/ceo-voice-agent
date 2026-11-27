import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionQuery, useCurrentSessionUser } from '../../../shared/session';
import { getVoicePlaybackPreference, useCeoPreferences } from '../settings/preferences';
import {
  applyMicGate, clearHandshakeTimer, closeReasonMessage, endAttempt, newAttempt, sealPlayback, suppressPlayback,
  voiceReady, type VoiceAttempt,
} from './voice-attempt';
import { connectVoiceAttempt } from './voice-connect';
import { audioUnavailableMessage, canPlayVoice, playVoiceAudio } from './voice-playback';
import { readVoiceEvent, type VoiceStage } from './voice-protocol';
import { reportBrowserPlayback } from './voice-transport';
import { closedVoiceView, freshVoiceView, type VoiceView } from './voice-view';

export function useVoiceHarness() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const running = useRef<VoiceAttempt>(null);
  const [view, setView] = useState<VoiceView>(() => freshVoiceView('idle'));
  const cache = useQueryClient();
  const { id: userId } = useCurrentSessionUser();
  const { playVoiceAnswers } = useCeoPreferences();

  useEffect(() => {
    if (playVoiceAnswers) return;
    if (running.current) suppressPlayback(running.current);
    setView((previous) => ({ ...previous, phase: 'listening', playbackBlocked: false }));
  }, [playVoiceAnswers]);

  const close = useCallback((next: VoiceStage, error?: string, update = true) => {
    const attempt = running.current;
    running.current = null;
    if (attempt) endAttempt(attempt);
    if (update) setView((previous) => closedVoiceView(previous, next, error));
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
    const turn = attempt?.turn;
    if (!attempt || !turn) return;
    if (!getVoicePlaybackPreference(userId)) {
      suppressPlayback(attempt);
      setView((previous) => ({ ...previous, phase: 'listening', playbackBlocked: false }));
      return;
    }
    const outcome = await playVoiceAudio(attempt, turn);
    if (!outcome || running.current !== attempt || attempt.turn !== turn) return;
    setView((previous) => ({
      ...previous, playbackBlocked: outcome === 'blocked',
      phase: outcome === 'failed' || outcome === 'blocked' ? 'listening' : previous.phase,
      error: outcome === 'failed' ? audioUnavailableMessage : previous.error,
    }));
  }

  function syncConnection(attempt: VoiceAttempt) {
    const ready = voiceReady(attempt);
    applyMicGate(attempt);
    if (ready) clearHandshakeTimer(attempt);
    setView((previous) => ({
      ...previous, stage: ready ? attempt.stage : 'connecting', playbackBlocked: false,
      phase: attempt.stage === 'standby' || !attempt.turn ? 'listening' : previous.phase,
    }));
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
        if (event.state !== 'active') sealPlayback(attempt);
        attempt.stage = event.state;
        syncConnection(attempt);
        return;
      }
      case 'turn':
        if (attempt.turn && event.generation <= attempt.turn.generation) return;
        sealPlayback(attempt);
        attempt.turn = {
          id: event.turnId, generation: event.generation, startedAt: performance.now(),
          measured: false, approved: false, sealed: false, playRequested: false, fetch: null, objectUrl: null,
        };
        setView((previous) => ({ ...previous, phase: 'searching', error: undefined, result: undefined, timingMs: undefined, playbackBlocked: false }));
        return;
      case 'result':
        if (attempt.turn?.id === event.turnId && attempt.turn.generation === event.generation && !attempt.turn.sealed) {
          setView((previous) => ({ ...previous, result: event.result }));
        }
        return;
      case 'playback':
        if (attempt.turn?.id !== event.turnId || attempt.turn.generation !== event.generation || attempt.turn.sealed) return;
        if (event.allowed) {
          if (attempt.turn.approved) return;
          attempt.turn.approved = true;
          if (attempt.activity?.speaking() && !attempt.micMuted) {
            sealPlayback(attempt);
            return;
          }
          void playAllowed(attempt);
        } else {
          sealPlayback(attempt);
          setView((previous) => ({
            ...previous, phase: 'listening', playbackBlocked: false, error: event.reason === 'unverified' ? audioUnavailableMessage : previous.error,
          }));
        }
    }
  }

  async function start() {
    if (running.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection !== 'function' || typeof EventSource !== 'function') {
      setView(freshVoiceView('unavailable', 'Browser ini tidak menyediakan akses mikrofon dan WebRTC.'));
      return;
    }
    const attempt = newAttempt(audioRef.current, () => getVoicePlaybackPreference(userId));
    running.current = attempt;
    setView(freshVoiceView('connecting'));
    await connectVoiceAttempt(attempt, {
      current: () => running.current === attempt,
      close,
      sync: () => syncConnection(attempt),
      event: (data) => readEvent(attempt, data),
      speech: () => {
        if (running.current !== attempt || !voiceReady(attempt) || attempt.micMuted) return;
        sealPlayback(attempt);
        setView((previous) => ({ ...previous, phase: 'listening', playbackBlocked: false }));
      },
    });
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
    const turn = attempt?.turn;
    const audio = attempt?.audio;
    if (!attempt || !turn?.objectUrl || !audio || audio.muted || audio.src !== turn.objectUrl || turn.measured || !canPlayVoice(attempt, turn)) return;
    turn.measured = true;
    const timingMs = Math.round(performance.now() - turn.startedAt);
    setView((previous) => ({ ...previous, phase: 'answering', timingMs }));
    if (attempt.id && timingMs <= 30_000) reportBrowserPlayback(attempt.id, turn.id, turn.generation, timingMs);
  }

  function markEnded() {
    const attempt = running.current;
    if (attempt?.audio?.ended && attempt.turn?.objectUrl === attempt.audio.src) {
      sealPlayback(attempt);
      setView((previous) => ({ ...previous, phase: 'listening' }));
    }
  }

  return { audioRef, view, start, end: () => close('closed'), toggleMic, playAllowed, markPlaying, markEnded };
}
