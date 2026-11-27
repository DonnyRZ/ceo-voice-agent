import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLiveEvent } from './live-events.js';
import { maximumVoiceCaptureMs } from './output-audio.js';
import { verifiedVoiceWav } from './wav.js';
import { answer, cutoff, frame, transcript, prepare, completeAudio, appendRun } from './output-test-fixture.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('pemilihan potongan PCM keluaran Live', () => {
  it('memverifikasi PCM dan transkrip utuh walau suara mulai sebelum batas perkiraan ACK', async () => {
    const { gate, turn } = prepare();
    gate.appendAudio(frame(900, cutoff, true));
    gate.appendTranscript(transcript('Jawaban lama salah.', 900, cutoff, 'old'));
    const pcm = completeAudio(gate);
    gate.appendTranscript(transcript(' PROYEK A selesai.', 1_080, 1_180, 'first'));
    gate.appendTranscript(transcript('  Total 12 tugas. ', 1_180, 1_250, 'second'));
    const result = turn.confirm(1_160);
    await vi.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toMatchObject({
      kind: 'verified', pcm, startMs: cutoff, endMs: 1_550,
      diagnostics: { frameCount: 3, transcriptCount: 2, firstFrameStartMs: cutoff, lastFrameEndMs: 1_550,
        firstTranscriptStartMs: 1_080, lastTranscriptEndMs: 1_250, cutoffMs: cutoff, ackEndMs: 1_160,
        speechStartMs: 1_080, speechEndMs: 1_250 },
    });
  });

  it('menguji offset pilot v8 ketika transkrip mendahului PCM dan ACK', async () => {
    const expected = 'Status proyek Sinkronisasi Arsip di divisi Finance sedang dikerjakan.';
    const { gate, turn } = prepare(expected, { transcriptSkewMs: 1_000, trailingSilenceMs: 400 }, 7_600);
    const audioStart = 11_000;
    appendRun(gate, audioStart, 11_502);
    appendRun(gate, 11_502, 15_630, true);
    appendRun(gate, 15_630, 16_399);
    gate.appendTranscript(transcript(' Status', 11_200, 11_400, 'v8-start'));
    gate.appendTranscript(transcript(' proyek Sinkronisasi Arsip di divisi Finance sedang dikerjakan.', 11_400, 15_000, 'v8-end'));
    const confirm = turn.confirm(11_400);
    const settled = vi.fn();
    void confirm.then(settled);
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).not.toHaveBeenCalled();
    gate.appendAudio(frame(16_399, 16_400));
    await vi.advanceTimersByTimeAsync(10);
    await expect(confirm).resolves.toMatchObject({
      kind: 'verified', startMs: 11_422, endMs: 16_030,
      diagnostics: { cutoffMs: 7_600, ackEndMs: 11_400, firstFrameStartMs: audioStart, firstTranscriptStartMs: 11_200,
        speechStartMs: 11_502, speechEndMs: 15_630, lastFrameEndMs: 16_400 },
    });
  });

  it.each(['Proyek A belum selesai. Total 12 tugas.', 'Proyek A selesai. Total 21 tugas.'])(
    'menahan keluaran %s yang berbeda dari fakta',
    async (text) => {
      const { gate, turn } = prepare();
      const result = turn.confirm(cutoff);
      completeAudio(gate);
      gate.appendTranscript(transcript(text));
      await vi.advanceTimersByTimeAsync(10);
      await expect(result).resolves.toMatchObject({ kind: 'withheld', reason: 'mismatch' });
    },
  );

  it('mengenali frame hilang dan awal ucapan yang terpotong', async () => {
    for (const [ranges, diagnostics] of [
      [[frame(cutoff, 1_070), frame(1_080, 1_250, true)], { detail: 'frame_gap', missingFrameFromMs: 1_070, missingFrameToMs: 1_080 }],
      [[frame(cutoff, 1_250, true)], { detail: 'missing_leading_silence', speechStartMs: cutoff }],
    ] as const) {
      const { gate, turn } = prepare();
      const result = turn.confirm(cutoff);
      for (const chunk of ranges) gate.appendAudio(chunk);
      await expect(result).resolves.toMatchObject({ kind: 'withheld', reason: 'boundary', diagnostics });
    }
  });

  it('memeriksa ulang setelah ada ucapan tambahan sesudah jeda yang sempat terdeteksi', async () => {
    const { gate, turn } = prepare();
    const result = turn.confirm(cutoff);
    completeAudio(gate);
    gate.appendTranscript(transcript(answer));
    await vi.advanceTimersByTimeAsync(9);
    gate.appendAudio(frame(1_550, 1_720, true));
    gate.appendTranscript(transcript(' Ternyata belum.', 1_550, 1_720, 'late'));
    gate.appendAudio(frame(1_720, 2_020));
    await vi.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toMatchObject({ kind: 'withheld', reason: 'mismatch' });
  });

  it('menahan transkrip yang melampaui toleransi waktu meski kata-katanya cocok', async () => {
    const { gate, turn } = prepare(answer, { transcriptSkewMs: 10 });
    completeAudio(gate);
    gate.appendAudio(frame(1_550, 1_600));
    gate.appendTranscript(transcript(answer, 1_080, 1_261));
    const incompleteTranscript = turn.confirm(cutoff);
    await vi.advanceTimersByTimeAsync(750);
    await expect(incompleteTranscript).resolves.toMatchObject({
      kind: 'withheld', reason: 'timeout', diagnostics: { detail: 'incomplete_transcript_coverage' },
    });

  });

  it('menahan potongan saat hening akhir belum teramati', async () => {
    const { gate, turn } = prepare();
    gate.appendAudio(frame(cutoff, 1_080));
    gate.appendAudio(frame(1_080, 1_250, true));
    gate.appendTranscript(transcript(answer));
    const missingTail = turn.confirm(cutoff);
    await vi.advanceTimersByTimeAsync(750);
    await expect(missingTail).resolves.toMatchObject({
      kind: 'withheld', reason: 'timeout', diagnostics: { detail: 'missing_trailing_silence' },
    });
  });

  it('menerapkan konfirmasi tanpa offset ketika batas giliran dan seluruh PCM tersedia', async () => {
    const { gate, turn } = prepare();
    const pcm = completeAudio(gate);
    gate.appendTranscript(transcript(answer));
    const result = turn.confirm();
    await vi.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toMatchObject({ kind: 'verified', pcm });
  });

  it('mengabaikan hasil lama setelah interupsi dan tidak memutar replay lama pada giliran baru', async () => {
    const { gate, turn, controller } = prepare();
    const interrupted = turn.confirm(cutoff);
    completeAudio(gate);
    gate.appendTranscript(transcript(answer));
    controller.abort();
    await expect(interrupted).resolves.toMatchObject({ kind: 'withheld', reason: 'aborted' });
    gate.reset();
    const fresh = gate.begin(answer, new AbortController().signal, { notBeforeMs: 1_300 });
    completeAudio(gate);
    gate.appendTranscript(transcript(answer));
    const replay = fresh.confirm(1_590);
    await vi.advanceTimersByTimeAsync(750);
    await expect(replay).resolves.toMatchObject({
      kind: 'withheld', reason: 'timeout', diagnostics: { frameCount: 0, transcriptCount: 0, cutoffMs: 1_550 },
    });
  });

  it('menolak transkrip lama yang bersinggungan dengan batas giliran baru', async () => {
    const { gate, turn } = prepare();
    gate.appendTranscript(transcript(answer, 900, 1_100));
    await expect(turn.confirm(1_110)).resolves.toMatchObject({
      kind: 'withheld', reason: 'boundary', diagnostics: { detail: 'transcript_outside_segment' },
    });
  });

  it('membatasi durasi PCM yang ditahan', async () => {
    const { gate, turn } = prepare(answer, {}, 0);
    appendRun(gate, 0, maximumVoiceCaptureMs + 1);
    await expect(turn.confirm(0)).resolves.toMatchObject({
      kind: 'withheld', reason: 'overflow', diagnostics: { detail: 'pcm_limit' },
    });
  });

  it('mengemas jawaban utuh di atas delapan detik sebagai WAV', async () => {
    const { gate, turn } = prepare(answer, { transcriptSkewMs: 1_000 });
    appendRun(gate, cutoff, 1_080);
    appendRun(gate, 1_080, 9_680, true);
    gate.appendTranscript(transcript(answer, 1_080, 9_680));
    appendRun(gate, 9_680, 10_980);
    const result = turn.confirm(cutoff);
    await vi.advanceTimersByTimeAsync(10);
    const outcome = await result;
    expect(outcome.kind).toBe('verified');
    if (outcome.kind === 'verified') {
      expect(verifiedVoiceWav(outcome.pcm)?.subarray(44)).toEqual(outcome.pcm);
    }
  });
});

describe('parsing audio sideband Live', () => {
  it('membaca hanya PCM WebRTC yang memiliki offset dan jumlah frame tepat', () => {
    const pcm = frame(50, 70, true).pcm;
    const event = { type: 'session.output_audio.delta', delta: pcm.toString('base64'), start_ms: 50, end_ms: 70 };
    expect(parseLiveEvent(JSON.stringify(event))).toEqual({ type: 'output_audio', frame: { pcm, startMs: 50, endMs: 70 } });
    expect(parseLiveEvent(JSON.stringify({ ...event, end_ms: 71 }))).toBeUndefined();
    expect(parseLiveEvent(JSON.stringify({ ...event, start_ms: undefined }))).toBeUndefined();
    expect(parseLiveEvent(JSON.stringify({ ...event, delta: '!' + event.delta.slice(1) }))).toBeUndefined();
  });

  it('mengaitkan offset ACK ke event id aplikasi', () => {
    expect(parseLiveEvent(JSON.stringify({ type: 'session.commentary.appended', client_event_id: 'pending', end_ms: 50 })))
      .toEqual({ type: 'commentary_accepted', eventId: 'pending', endMs: 50 });
  });
});
