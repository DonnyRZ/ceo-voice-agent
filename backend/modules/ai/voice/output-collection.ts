import { voicePcmBytesPerMs } from '../../../../shared/voice-pcm.js';
import { createSpeechCapture, validOutputFrame, type VoiceOutputFrame, type VoiceSpeechSegment } from './output-audio.js';
import type { VoiceOutputDetail, VoiceOutputDiagnostics } from './output-diagnostics.js';
import { normalizedReadout } from './output-readout.js';
import type { VoiceTranscriptFragment } from './transcript.js';

export type VerificationVerdict =
  | ({ kind: 'verified' } & VoiceOutputFrame)
  | { kind: 'withheld'; reason: 'aborted' | 'boundary' | 'timeout' | 'mismatch' | 'overflow' };

export type VoiceOutputResult = VerificationVerdict & { diagnostics?: VoiceOutputDiagnostics };

export type VoiceOutputCollectionOptions = {
  timeoutMs: number;
  leadingSilenceMs: number;
  trailingSilenceMs: number;
  transcriptSettleMs: number;
  transcriptSkewMs: number;
};

const maxTranscriptFragments = 400;
const maxTranscriptCharacters = 3_600;

export function createOutputCollection(expectedText: string, signal: AbortSignal, cutoffMs: number, {
  timeoutMs, leadingSilenceMs, trailingSilenceMs, transcriptSettleMs, transcriptSkewMs,
}: VoiceOutputCollectionOptions) {
  const expected = normalizedReadout(expectedText);
  const fragments: VoiceTranscriptFragment[] = [];
  const eventIds = new Set<string>();
  const diagnostics: VoiceOutputDiagnostics = { frameCount: 0, transcriptCount: 0, cutoffMs };
  let waitingFor: VoiceOutputDetail = 'awaiting_ack';
  let characters = 0;
  let accepted = false;
  let capture: ReturnType<typeof createSpeechCapture> | undefined = createSpeechCapture(cutoffMs, leadingSilenceMs, trailingSilenceMs);
  let segment: VoiceSpeechSegment | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  let complete: (result: VoiceOutputResult) => void;
  const result = new Promise<VoiceOutputResult>((resolve) => { complete = resolve; });
  const deadline = setTimeout(() => finish({ kind: 'withheld', reason: 'timeout' }, waitingFor), timeoutMs);
  deadline.unref?.();
  signal.addEventListener('abort', cancel, { once: true });

  function finish(verdict: VerificationVerdict, detail?: VoiceOutputDetail) {
    if (done) return;
    done = true;
    clearTimeout(deadline);
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
    fragments.length = 0;
    eventIds.clear();
    segment = undefined;
    capture = undefined;
    complete({ ...verdict, diagnostics: { ...diagnostics, detail } });
  }

  function cancel() {
    finish({ kind: 'withheld', reason: 'aborted' });
  }

  if (signal.aborted) cancel();

  function inspect() {
    const candidate = segment;
    if (!accepted || !candidate) return;
    waitingFor = fragments.length ? 'incomplete_transcript_coverage' : 'missing_transcript';
    if (!fragments.length) return;
    const speechStart = candidate.voiced[0].startMs;
    const speechEnd = candidate.voiced.at(-1)!.endMs;
    const transcriptStart = fragments[0].startMs;
    const transcriptEnd = Math.max(...fragments.map(({ endMs }) => endMs));
    const text = normalizedReadout(fragments.map(({ text }) => text).join(''));
    if (text && text !== expected && expected.startsWith(text)) return;
    if (Math.abs(transcriptStart - speechStart) > transcriptSkewMs
      || Math.abs(transcriptEnd - speechEnd) > transcriptSkewMs) {
      return;
    }
    // The transcript clock may lead the waveform. Observe real audio through that uncertainty window.
    if ((diagnostics.lastFrameEndMs ?? cutoffMs) < transcriptEnd + transcriptSkewMs + trailingSilenceMs) return;
    if (text !== expected) {
      finish({ kind: 'withheld', reason: 'mismatch' });
      return;
    }
    const { pcm, startMs, endMs } = candidate;
    finish({ kind: 'verified', pcm, startMs, endMs });
  }

  function scheduleInspection() {
    if (!accepted || !segment || timer) return;
    waitingFor = 'settling_transcript';
    timer = setTimeout(() => {
      timer = undefined;
      inspect();
    }, transcriptSettleMs);
    timer.unref?.();
  }

  function consume(frame: VoiceOutputFrame) {
    const candidate = capture?.append(frame);
    if (frame.endMs > cutoffMs) {
      const previousEnd = diagnostics.speechEndMs;
      diagnostics.speechStartMs = capture?.speechStartMs();
      diagnostics.speechEndMs = capture?.speechEndMs();
      if (previousEnd !== diagnostics.speechEndMs) {
        clearTimeout(timer);
        timer = undefined;
        segment = undefined;
      }
      if (accepted) waitingFor = diagnostics.speechStartMs === undefined ? 'no_audible_pcm' : 'missing_trailing_silence';
    }
    if (!candidate) return;
    if (candidate.kind !== 'segment') {
      diagnostics.missingFrameFromMs = candidate.missingFrameFromMs;
      diagnostics.missingFrameToMs = candidate.missingFrameToMs;
      finish({ kind: 'withheld', reason: candidate.kind }, candidate.detail);
      return;
    }
    segment = candidate.segment;
    scheduleInspection();
  }

  return {
    cancel,
    confirm(ackEndMs?: number) {
      if (!done && !accepted) {
        accepted = true;
        diagnostics.ackEndMs = ackEndMs;
        if (!expected) finish({ kind: 'withheld', reason: 'boundary' }, 'invalid_transcript');
        else waitingFor = !diagnostics.frameCount ? 'no_pcm' : diagnostics.speechStartMs === undefined
          ? 'no_audible_pcm' : 'missing_trailing_silence';
        scheduleInspection();
      }
      return result;
    },
    appendAudio(frame: VoiceOutputFrame) {
      if (done || frame.endMs <= cutoffMs) return;
      const duration = frame.endMs - frame.startMs;
      if (!validOutputFrame(frame.startMs, frame.endMs) || frame.pcm.length !== duration * voicePcmBytesPerMs) {
        finish({ kind: 'withheld', reason: 'boundary' }, 'invalid_pcm');
        return;
      }
      diagnostics.frameCount += 1;
      diagnostics.firstFrameStartMs = Math.min(diagnostics.firstFrameStartMs ?? frame.startMs, frame.startMs);
      diagnostics.lastFrameEndMs = Math.max(diagnostics.lastFrameEndMs ?? frame.endMs, frame.endMs);
      consume(frame);
    },
    appendTranscript(fragment: VoiceTranscriptFragment) {
      if (done || fragment.role !== 'assistant' || fragment.endMs <= cutoffMs || eventIds.has(fragment.eventId)) return;
      if (!Number.isSafeInteger(fragment.startMs) || !Number.isSafeInteger(fragment.endMs)
        || fragment.startMs < 0 || fragment.endMs <= fragment.startMs) {
        finish({ kind: 'withheld', reason: 'boundary' }, 'invalid_transcript');
        return;
      }
      if (fragment.startMs < cutoffMs || fragment.startMs < (fragments.at(-1)?.startMs ?? cutoffMs)) {
        finish({ kind: 'withheld', reason: 'boundary' }, fragment.startMs < cutoffMs ? 'transcript_outside_segment' : 'unordered_transcript');
        return;
      }
      characters += fragment.text.length;
      if (characters > maxTranscriptCharacters || fragments.length >= maxTranscriptFragments) {
        finish({ kind: 'withheld', reason: 'overflow' }, 'transcript_limit');
        return;
      }
      eventIds.add(fragment.eventId);
      fragments.push(fragment);
      diagnostics.transcriptCount += 1;
      diagnostics.firstTranscriptStartMs = Math.min(diagnostics.firstTranscriptStartMs ?? fragment.startMs, fragment.startMs);
      diagnostics.lastTranscriptEndMs = Math.max(diagnostics.lastTranscriptEndMs ?? fragment.endMs, fragment.endMs);
      clearTimeout(timer);
      timer = undefined;
      scheduleInspection();
    },
  };
}
