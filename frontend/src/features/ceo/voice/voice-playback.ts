import { sealPlayback, voiceReady, type VoiceAttempt, type VoiceTurn } from './voice-attempt';
import { fetchVoiceAudio, holdAudio } from './voice-transport';

export const audioUnavailableMessage = 'Audio jawaban tidak dapat diverifikasi.';

export function canPlayVoice(attempt: VoiceAttempt, turn: VoiceTurn) {
  return !attempt.signal.signal.aborted && attempt.turn === turn && turn.approved && !turn.sealed
    && attempt.playbackEnabled?.() !== false
    && attempt.stage === 'active' && voiceReady(attempt) && (!attempt.activity?.speaking() || attempt.micMuted);
}

export async function playVoiceAudio(attempt: VoiceAttempt, turn: VoiceTurn) {
  const { id, audio } = attempt;
  if (!id || !audio || !canPlayVoice(attempt, turn) || turn.playRequested) return;
  if (!turn.objectUrl) {
    if (turn.fetch) return;
    const controller = new AbortController();
    turn.fetch = controller;
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 5_000);
    try {
      const clip = await fetchVoiceAudio(id, turn.id, turn.generation, controller.signal);
      if (!canPlayVoice(attempt, turn) || controller.signal.aborted) return;
      turn.objectUrl = URL.createObjectURL(clip);
      audio.src = turn.objectUrl;
    } catch {
      if ((!controller.signal.aborted || timedOut) && canPlayVoice(attempt, turn)) {
        sealPlayback(attempt);
        return 'failed';
      }
      return;
    } finally {
      window.clearTimeout(timer);
      if (turn.fetch === controller) turn.fetch = null;
    }
  }
  if (!canPlayVoice(attempt, turn)) return;
  turn.playRequested = true;
  audio.muted = false;
  try {
    await audio.play();
    if (canPlayVoice(attempt, turn)) return 'playing';
  } catch (error) {
    if (!canPlayVoice(attempt, turn)) return;
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      holdAudio(audio);
      turn.playRequested = false;
      return 'blocked';
    }
    sealPlayback(attempt);
    return 'failed';
  }
}
