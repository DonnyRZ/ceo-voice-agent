import type { VoiceCloseReason, VoiceEvent, VoiceMetric, VoiceResult } from '../types.js';
import type { VoiceTranscriptFragment } from '../transcript.js';

export type PlaybackStop = VoiceCloseReason | 'new_speech' | 'new_delegation' | 'standby';

export type VoiceHistoryEntry<Facts> =
  | { type: 'session_attempt'; userId: string; model?: string }
  | { type: 'metric'; turnId?: string; metric: VoiceMetric }
  | { type: 'transcript'; fragment: VoiceTranscriptFragment }
  | { type: 'turn_input'; turnId: string; text: string; userEndMs: number; delegationOffsetMs: number }
  | { type: 'commentary_sent'; turnId: string; text: string; result: VoiceResult<Facts> }
  | Extract<VoiceEvent<Facts>, { type: 'playback' }>
  | { type: 'playback_stopped'; turnId: string; reason: PlaybackStop }
  | { type: 'browser_playback'; elapsedMs: number }
  | { type: 'usage'; seconds: number; final: boolean }
  | { type: 'provider_error'; code: string };
