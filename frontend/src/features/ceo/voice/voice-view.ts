import type { VoiceResult, VoiceStage } from './voice-protocol';

export type VoicePhase = 'listening' | 'searching' | 'answering';

export interface VoiceView {
  stage: VoiceStage;
  phase: VoicePhase;
  micMuted: boolean;
  playbackBlocked: boolean;
  error?: string;
  result?: VoiceResult;
  timingMs?: number;
}

export const freshVoiceView = (stage: VoiceStage, error?: string): VoiceView => ({
  stage, error, phase: 'listening', micMuted: false, playbackBlocked: false,
});

export function closedVoiceView(previous: VoiceView, stage: VoiceStage, error?: string): VoiceView {
  const next = freshVoiceView(stage, error);
  if (stage === 'closed' && !error && previous.result?.kind === 'facts') next.result = previous.result;
  return next;
}
