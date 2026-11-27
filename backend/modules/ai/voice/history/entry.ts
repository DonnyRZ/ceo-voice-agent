import type { VoiceCloseReason, VoiceEvent, VoiceMetric, VoiceResult, VoiceTurnKey } from '../types.js';
import type { VoiceTranscriptFragment } from '../transcript.js';

export type PlaybackStop = VoiceCloseReason | 'new_speech' | 'new_delegation' | 'standby' | 'missing_input';

export type VoiceHistoryEntry<Facts> =
  | { type: 'session_attempt'; userId: string; model?: string }
  | { type: 'metric'; turnId?: string; metric: VoiceMetric }
  | { type: 'transcript'; fragment: VoiceTranscriptFragment }
  | { type: 'delegation_received'; turnId: string; offsetMs: number }
  | { type: 'turn_input'; turnId: string; text: string; userEndMs: number; delegationOffsetMs: number }
  | { type: 'commentary_sent'; turnId: string; commandId?: string; text: string; result: VoiceResult<Facts> }
  | { type: 'commentary_ack'; turnId: string; commandId: string; accepted: boolean; endMs?: number }
  | Extract<VoiceEvent<Facts>, { type: 'playback' }>
  | (VoiceTurnKey & { type: 'playback_stopped'; reason: PlaybackStop })
  | (VoiceTurnKey & { type: 'browser_playback'; elapsedMs: number })
  | { type: 'usage'; seconds: number; final: boolean }
  | { type: 'provider_error'; code: string };
