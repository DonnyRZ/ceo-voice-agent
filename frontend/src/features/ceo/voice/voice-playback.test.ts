import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newAttempt, suppressPlayback, type VoiceAttempt } from './voice-attempt';
import { playVoiceAudio } from './voice-playback';

const fetchAudio = vi.hoisted(() => vi.fn());
vi.mock('./voice-transport', () => ({
  fetchVoiceAudio: fetchAudio,
  holdAudio: (audio: HTMLAudioElement | null) => { if (audio) { audio.muted = true; audio.pause(); } },
}));

describe('account playback preference', () => {
  let enabled: boolean;
  let attempt: VoiceAttempt;
  let audio: HTMLAudioElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    enabled = true;
    audio = {
      muted: true, play: vi.fn(async () => undefined), pause: vi.fn(),
      removeAttribute: vi.fn(), load: vi.fn(),
    } as unknown as HTMLAudioElement;
    attempt = newAttempt(audio, () => enabled);
    attempt.id = 'current-session';
    attempt.stage = 'active';
    attempt.peer = { connectionState: 'connected' } as RTCPeerConnection;
    attempt.turn = {
      id: 'current-turn', generation: 1, startedAt: 0, measured: false, approved: true,
      sealed: false, playRequested: false, fetch: null, objectUrl: null,
    };
  });

  afterEach(() => vi.unstubAllGlobals());

  it('never downloads or starts an answer when account playback is disabled', async () => {
    enabled = false;
    await playVoiceAudio(attempt, attempt.turn!);
    expect(fetchAudio).not.toHaveBeenCalled();
    expect(audio.play).not.toHaveBeenCalled();
    expect(audio.muted).toBe(true);
  });

  it('cancels a pending clip without sealing its facts and refuses old replay after re-enabling', async () => {
    let finish!: (clip: Blob) => void;
    fetchAudio.mockImplementation(() => new Promise<Blob>((resolve) => { finish = resolve; }));
    const playback = playVoiceAudio(attempt, attempt.turn!);
    const signal = attempt.turn!.fetch!.signal;
    enabled = false;
    suppressPlayback(attempt);
    finish(new Blob(['verified-answer']));
    await playback;
    expect(signal.aborted).toBe(true);
    expect(attempt.turn!.sealed).toBe(false);
    expect(audio.play).not.toHaveBeenCalled();
    expect(audio.muted).toBe(true);
    enabled = true;
    await playVoiceAudio(attempt, attempt.turn!);
    expect(fetchAudio).toHaveBeenCalledOnce();
    expect(audio.play).not.toHaveBeenCalled();
  });
});
