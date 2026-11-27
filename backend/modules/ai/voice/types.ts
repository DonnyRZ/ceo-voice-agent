import type { VoiceTranscriptFragment, VoiceTranscriptMessage } from './transcript.js';
import type { VoiceHistoryEntry } from './history/entry.js';

export interface VoiceOwner {
  userId: string;
  sessionKey: string;
}

export interface OwnedVoiceSession extends VoiceOwner {
  id: string;
}

export type VoiceState = 'connecting' | 'active' | 'standby' | 'closed' | 'unavailable';
export type VoiceCloseReason = 'revoked' | 'ended' | 'timeout' | 'unavailable';
export type VoiceResultKind = 'facts' | 'clarify' | 'no_match' | 'unsupported' | 'unavailable';

export interface VoiceResult<Facts> {
  kind: VoiceResultKind;
  text: string;
  facts?: Facts;
}

export type VoiceEvent<Facts> =
  | { type: 'state'; state: VoiceState; reason?: VoiceCloseReason }
  | { type: 'turn'; turnId: string }
  | { type: 'result'; turnId: string; result: VoiceResult<Facts> }
  | { type: 'playback'; turnId: string; allowed: boolean };

export type VoiceMetric =
  | { type: 'session'; action: 'started' | 'closed' | 'failed'; reason?: VoiceCloseReason; durationMs: number }
  | { type: 'state'; state: 'active' | 'standby' }
  | { type: 'delegation'; action: 'started' | 'discarded' }
  | { type: 'retrieval'; outcome: VoiceResultKind | 'timeout' | 'error' | 'discarded'; durationMs: number }
  | { type: 'latency'; stage: 'input_to_delegation' | 'commentary_ack' | 'delegation_to_playback_allowed'; outcome: 'observed' | 'accepted' | 'rejected' | 'timeout'; durationMs: number };

export type LiveEvent =
  | { type: 'active' | 'standby' }
  | { type: 'transcript'; fragment: VoiceTranscriptFragment }
  | { type: 'delegation'; id: string; offsetMs: number }
  | { type: 'usage'; seconds: number }
  | { type: 'provider_error'; code: string }
  | { type: 'closed'; seconds?: number; reason?: VoiceCloseReason }
  | { type: 'commentary_accepted' | 'commentary_rejected'; eventId: string };

export interface LiveSideband {
  silenceAcknowledgment?(delegationId: string): void;
  sendCommentary(eventId: string, delegationId: string, text: string): void;
  finish(): Promise<boolean>;
}

export interface LiveHandlers {
  onEvent(event: LiveEvent): void;
  onDisconnect(): void;
}

export interface VoiceAdapter {
  createSession(sdp: string, signal: AbortSignal): Promise<{ id: string; sdp: string }>;
  attach(id: string, handlers: LiveHandlers, signal: AbortSignal): Promise<LiveSideband>;
  closeSession(id: string, sideband?: LiveSideband, onEvent?: LiveHandlers['onEvent']): Promise<void>;
}

export interface VoiceServiceOptions<Context, Facts, Prepared = unknown> {
  adapter: VoiceAdapter;
  authorize?(owner: VoiceOwner): Promise<boolean>;
  prepare?(input: VoiceOwner & { text: string; context?: Context; signal: AbortSignal }): Promise<Prepared | undefined>;
  retrieve(input: VoiceOwner & {
    text: string;
    history: VoiceTranscriptMessage[];
    context?: Context;
    prepared?: Prepared;
    signal: AbortSignal;
  }): Promise<VoiceResult<Facts> & { context?: Context }>;
  onMetric?(metric: VoiceMetric): void;
  onHistory?(sessionId: string, sequence: number, entry: VoiceHistoryEntry<Facts>): void;
  onUsage?(usage: { id: string; providerId?: string; userId: string; seconds: number; final: boolean }): void;
  maxDurationMs?: number;
  maxSessions?: number;
  startupTimeoutMs?: number;
  accessCheckMs?: number;
  accessTimeoutMs?: number;
  settleMs?: number;
  prepareDelayMs?: number;
  retrievalTimeoutMs?: number;
  commentaryTimeoutMs?: number;
}
