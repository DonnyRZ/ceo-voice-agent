import { maximumVoiceClipMs, voicePcmBytesPerMs } from '../../../../shared/voice-pcm.js';
import type { VoiceOutputDetail } from './output-diagnostics.js';

const maximumFrameMs = 1_000;
export const maximumVoiceCaptureMs = maximumVoiceClipMs + 3_000;
const voicedSampleThreshold = 128;

export interface VoiceAudioRange {
  startMs: number;
  endMs: number;
}

export interface VoiceOutputFrame extends VoiceAudioRange {
  pcm: Buffer;
}

export interface VoiceSpeechSegment extends VoiceOutputFrame {
  voiced: VoiceAudioRange[];
}

export function validOutputFrame(startMs: number, endMs: number) {
  return Number.isSafeInteger(startMs) && startMs >= 0 && Number.isSafeInteger(endMs)
    && endMs > startMs && endMs - startMs <= maximumFrameMs;
}

export function decodeReflectedPcm(data: unknown, startMs: number, endMs: number) {
  if (typeof data !== 'string' || !validOutputFrame(startMs, endMs)) return;
  const expectedBytes = (endMs - startMs) * voicePcmBytesPerMs;
  if (data.length !== 4 * Math.ceil(expectedBytes / 3)) return;
  const pcm = Buffer.from(data, 'base64');
  if (pcm.length !== expectedBytes || pcm.toString('base64') !== data) return;
  return pcm;
}

type CaptureResult =
  | { kind: 'segment'; segment: VoiceSpeechSegment }
  | {
    kind: 'boundary' | 'overflow';
    detail: VoiceOutputDetail;
    missingFrameFromMs?: number;
    missingFrameToMs?: number;
  };

export function createSpeechCapture(cutoffMs: number, leadingMs: number, trailingMs: number) {
  const buffers: Buffer[] = [];
  const voiced: VoiceAudioRange[] = [];
  let runStartMs: number | undefined;
  let endMs: number | undefined;

  function append(frame: VoiceOutputFrame): CaptureResult | undefined {
    if (frame.endMs <= cutoffMs) return;
    const startMs = Math.max(cutoffMs, frame.startMs);
    if (endMs !== undefined && startMs > endMs) return {
      kind: 'boundary', detail: 'frame_gap', missingFrameFromMs: endMs, missingFrameToMs: startMs,
    };
    if (endMs !== undefined && startMs < endMs) return { kind: 'boundary', detail: 'frame_overlap' };
    runStartMs ??= startMs;
    if (frame.endMs - runStartMs > maximumVoiceCaptureMs) return { kind: 'overflow', detail: 'pcm_limit' };
    const pcm = frame.pcm.subarray((startMs - frame.startMs) * voicePcmBytesPerMs);
    if (pcm.length !== (frame.endMs - startMs) * voicePcmBytesPerMs) {
      return { kind: 'boundary', detail: 'invalid_pcm' };
    }
    buffers.push(pcm);
    endMs = frame.endMs;

    for (let position = startMs; position < frame.endMs; position += 1) {
      const offset = (position - startMs) * voicePcmBytesPerMs;
      const last = voiced.at(-1);
      if (hasVoice(pcm, offset)) {
        if (last?.endMs === position) last.endMs += 1;
        else voiced.push({ startMs: position, endMs: position + 1 });
        if (!last && position - runStartMs < leadingMs) return { kind: 'boundary', detail: 'missing_leading_silence' };
      }
    }
    const last = voiced.at(-1);
    if (last && last.endMs - voiced[0].startMs + leadingMs + trailingMs > maximumVoiceClipMs) {
      return { kind: 'overflow', detail: 'pcm_limit' };
    }
    if (last && endMs - last.endMs >= trailingMs) {
      const segmentStartMs = voiced[0].startMs - leadingMs;
      const segmentEndMs = last.endMs + trailingMs;
      return {
        kind: 'segment',
        segment: {
          startMs: segmentStartMs, endMs: segmentEndMs, voiced,
          pcm: Buffer.concat(buffers).subarray(
            (segmentStartMs - runStartMs) * voicePcmBytesPerMs,
            (segmentEndMs - runStartMs) * voicePcmBytesPerMs,
          ),
        },
      };
    }
  }

  return { append, speechStartMs: () => voiced[0]?.startMs, speechEndMs: () => voiced.at(-1)?.endMs };
}

function hasVoice(pcm: Buffer, offset: number) {
  for (let byte = offset; byte < offset + voicePcmBytesPerMs; byte += 2) {
    if (Math.abs(pcm.readInt16LE(byte)) >= voicedSampleThreshold) return true;
  }
  return false;
}
