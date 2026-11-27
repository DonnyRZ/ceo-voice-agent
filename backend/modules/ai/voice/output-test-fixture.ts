import { createVoiceOutputVerifier, type VoiceOutputFrame } from './output.js';
import type { VoiceTranscriptFragment } from './transcript.js';

export const answer = 'Proyek A selesai. Total 12 tugas.';
export const cutoff = 1_000;

export function frame(startMs: number, endMs: number, vocal = false): VoiceOutputFrame {
  const pcm = Buffer.alloc((endMs - startMs) * 48);
  if (vocal) {
    for (let byte = 0; byte < pcm.length; byte += 2) pcm.writeInt16LE(1_000, byte);
  }
  return { startMs, endMs, pcm };
}

export function transcript(text: string, startMs = 1_080, endMs = 1_250, eventId = 'spoken'): VoiceTranscriptFragment {
  return { role: 'assistant', text, eventId, startMs, endMs };
}

type VerifierOptions = NonNullable<Parameters<typeof createVoiceOutputVerifier>[0]>;

export function prepare(expected = answer, options: VerifierOptions = {}, notBeforeMs = cutoff) {
  const gate = createVoiceOutputVerifier({
    timeoutMs: 750, transcriptSettleMs: 10, transcriptSkewMs: 0, trailingSilenceMs: 300, ...options,
  });
  const controller = new AbortController();
  const turn = gate.begin(expected, controller.signal, { notBeforeMs });
  return { gate, controller, turn };
}

export function completeAudio(gate: ReturnType<typeof createVoiceOutputVerifier>) {
  const frames = [frame(cutoff, 1_080), frame(1_080, 1_250, true), frame(1_250, 1_550)];
  for (const chunk of frames) gate.appendAudio(chunk);
  return Buffer.concat(frames.map(({ pcm }) => pcm));
}

export function appendRun(gate: ReturnType<typeof createVoiceOutputVerifier>, startMs: number, endMs: number, vocal = false) {
  for (let offset = startMs; offset < endMs; offset += 1_000) {
    gate.appendAudio(frame(offset, Math.min(endMs, offset + 1_000), vocal));
  }
}
