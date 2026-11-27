export type VoiceOutputDetail =
  | 'awaiting_ack' | 'no_pcm' | 'invalid_pcm'
  | 'frame_gap' | 'frame_overlap' | 'missing_leading_silence'
  | 'no_audible_pcm' | 'missing_trailing_silence' | 'pcm_limit'
  | 'missing_transcript' | 'incomplete_transcript_coverage' | 'settling_transcript'
  | 'invalid_transcript' | 'unordered_transcript' | 'transcript_outside_segment' | 'transcript_limit';

export interface VoiceOutputDiagnostics {
  frameCount: number;
  transcriptCount: number;
  firstFrameStartMs?: number;
  lastFrameEndMs?: number;
  firstTranscriptStartMs?: number;
  lastTranscriptEndMs?: number;
  cutoffMs?: number;
  ackEndMs?: number;
  speechStartMs?: number;
  speechEndMs?: number;
  missingFrameFromMs?: number;
  missingFrameToMs?: number;
  detail?: VoiceOutputDetail;
}
