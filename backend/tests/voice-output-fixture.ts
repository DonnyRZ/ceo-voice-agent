import type { LiveHandlers } from '../modules/ai/voice/types.js';

export function emitVoiceSegment(
  emit: LiveHandlers['onEvent'], eventId: string, text: string, offset = 1_600, trailingMs = 1_400,
) {
  function frame(startMs: number, endMs: number, sample = 0) {
    const pcm = Buffer.alloc((endMs - startMs) * 48);
    if (sample) for (let byte = 0; byte < pcm.length; byte += 2) pcm.writeInt16LE(sample, byte);
    emit({ type: 'output_audio', frame: { startMs, endMs, pcm } });
  }
  const speechEnd = offset + 250;
  frame(offset, offset + 80);
  frame(offset + 80, speechEnd, 1_000);
  emit({ type: 'transcript', fragment: {
    eventId: `speech-${eventId}`, role: 'assistant', text, startMs: offset + 80, endMs: speechEnd,
  } });
  const observedThrough = speechEnd + trailingMs;
  for (let start = speechEnd; start < observedThrough;) {
    const end = Math.min(start + 700, observedThrough);
    frame(start, end);
    start = end;
  }
}

export function deliverVerifiedAudio(emit: LiveHandlers['onEvent'], eventId: string, text: string, offset = 1_600) {
  emit({ type: 'commentary_accepted', eventId, endMs: offset });
  emitVoiceSegment(emit, eventId, text, offset);
}
