import { maximumVoiceCaptureMs, validOutputFrame, type VoiceOutputFrame } from './output-audio.js';
import { createOutputCollection } from './output-collection.js';
import type { VoiceTranscriptFragment } from './transcript.js';

export type { VoiceOutputFrame } from './output-audio.js';
export type { VoiceOutputDiagnostics } from './output-diagnostics.js';
export type { VoiceOutputResult } from './output-collection.js';

type Options = {
  timeoutMs?: number;
  leadingSilenceMs?: number;
  trailingSilenceMs?: number;
  transcriptSettleMs?: number;
  transcriptSkewMs?: number;
};

export function createVoiceOutputVerifier({
  timeoutMs = maximumVoiceCaptureMs, leadingSilenceMs = 80, trailingSilenceMs = 400, transcriptSettleMs = 250,
  transcriptSkewMs = 1_000,
}: Options = {}) {
  let current: ReturnType<typeof createOutputCollection> | undefined;
  let observedEndMs = 0;


  return {
    begin(expectedText: string, signal: AbortSignal, { notBeforeMs }: { notBeforeMs: number }) {
      current?.cancel();
      current = createOutputCollection(expectedText, signal, Math.max(notBeforeMs, observedEndMs), {
        timeoutMs, leadingSilenceMs, trailingSilenceMs, transcriptSettleMs, transcriptSkewMs,
      });
      return { confirm: current.confirm };
    },
    appendAudio(frame: VoiceOutputFrame) {
      if (validOutputFrame(frame.startMs, frame.endMs)) observedEndMs = Math.max(observedEndMs, frame.endMs);
      current?.appendAudio(frame);
    },
    appendTranscript(fragment: VoiceTranscriptFragment) {
      if (fragment.role !== 'assistant') return;
      if (Number.isSafeInteger(fragment.endMs)) observedEndMs = Math.max(observedEndMs, fragment.endMs);
      current?.appendTranscript(fragment);
    },
    reset() {
      current?.cancel();
      current = undefined;
    },
  };
}
