import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVoiceInput } from '../modules/ai/voice/input.js';
import type { VoiceTurn } from '../modules/ai/voice/transcript.js';

function harness() {
  const turns = {
    begin: vi.fn(() => true),
    observeUserAudio: vi.fn(),
    prepare: vi.fn(),
    resolve: vi.fn<(turn: VoiceTurn) => Promise<void>>().mockResolvedValue(undefined),
    unverifiedInput: vi.fn(),
  };
  const record = vi.fn();
  const input = createVoiceInput(turns, { prepareCandidates: false, metric: vi.fn(), record });
  const user = (eventId: string, text: string, startMs: number, endMs: number) =>
    input.append({ eventId, role: 'user', text, startMs, endMs });
  return { input, user, turns, record };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('perbaikan fragmen Live yang terlambat', () => {
  it('menunggu kata terakhir yang tiba melampaui handoff lama dan periode tenang', async () => {
    const { input, user, turns, record } = harness();
    user('focus', 'Bagaimana progres proyek yang menolong pegawai mendapatkan kembali surel yang', 2_200, 5_000);
    input.delegate('lookup', 5_600);
    await vi.advanceTimersByTimeAsync(650);
    expect(turns.resolve).not.toHaveBeenCalled();
    user('late', ' hilang', 5_600, 5_800);
    await vi.advanceTimersByTimeAsync(159);
    expect(turns.resolve).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(turns.resolve).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      id: 'lookup', text: 'Bagaimana progres proyek yang menolong pegawai mendapatkan kembali surel yang hilang',
      userEndMs: 5_800,
    }));
    expect(record).toHaveBeenCalledWith({ type: 'delegation_received', turnId: 'lookup', offsetMs: 5_600 });
  });

  it('membatalkan giliran lama dan menjaga koreksi yang mulai dekat dengan batas lama', async () => {
    const { input, user, turns } = harness();
    user('before', 'Status proyek Atlas?', 500, 900);
    input.delegate('superseded', 1_100);
    await vi.advanceTimersByTimeAsync(300);
    user('correction', 'Maksud saya proyek Bumi.', 1_050, 1_850);
    expect(turns.observeUserAudio).toHaveBeenLastCalledWith(1_850);
    input.delegate('corrected', 2_050);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(turns.resolve).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      id: 'corrected', text: 'Maksud saya proyek Bumi.',
      history: [{ role: 'user', text: 'Status proyek Atlas?' }],
    }));
  });

  it('menahan kueri bila fragmen terakhir datang terlalu dekat dengan batas waktu mutlak', async () => {
    const { input, user, turns } = harness();
    user('prefix', 'Rekap dari tanggal lima', 2_000, 2_800);
    input.delegate('deadline', 3_000);
    await vi.advanceTimersByTimeAsync(1_150);
    user('late', ' Desember', 3_000, 3_200);
    await vi.advanceTimersByTimeAsync(50);
    expect(turns.resolve).not.toHaveBeenCalled();
    expect(turns.unverifiedInput).toHaveBeenCalledExactlyOnceWith('deadline');
  });

  it('membersihkan timer ketika bicara lokal atau standby menghentikan giliran', async () => {
    const { input, user, turns } = harness();
    user('first', 'Tolong cek rekap.', 100, 1_000);
    input.delegate('interrupted', 1_100);
    input.interrupt();
    user('second', 'Bagaimana proyek ini?', 1_200, 1_900);
    input.delegate('paused', 2_000);
    input.pause();
    expect(user('replay', 'Bagaimana proyek ini?', 1_200, 1_900)).toBe(false);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(turns.resolve).not.toHaveBeenCalled();
  });
});
