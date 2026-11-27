import type { VoiceTranscriptFragment, VoiceTranscriptMessage } from './transcript.js';
import type { VoiceHistoryEntry } from './history/entry.js';
import type { IntentResponseMetadata } from '../retrieval/interpretation.js';
import type { VoiceOutputDiagnostics, VoiceOutputFrame } from './output.js';
import type { VoiceVocabulary } from './vocabulary.js';

export interface VoiceOwner {
  userId: string;
  sessionKey: string;
}

export interface OwnedVoiceSession extends VoiceOwner {
  id: string;
}

export interface VoiceTurnKey {
  turnId: string;
  generation: number;
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
  | (VoiceTurnKey & { type: 'turn' })
  | (VoiceTurnKey & { type: 'result'; result: VoiceResult<Facts> })
  | (VoiceTurnKey & { type: 'playback'; allowed: boolean; reason?: 'unverified' });

export type VoiceRetrievalPhaseMetric = {
  type: 'latency';
  stage: 'division_lookup' | 'intent_inference' | 'scope_recheck' | 'candidate_lookup' | 'semantic_lookup' | 'facts_lookup';
  outcome: 'observed' | 'error' | 'timeout' | 'discarded';
  durationMs: number;
  provider?: IntentResponseMetadata;
};

export type VoiceMetric =
  | { type: 'session'; action: 'started' | 'closed' | 'failed'; reason?: VoiceCloseReason; durationMs: number }
  | { type: 'state'; state: 'active' | 'standby' }
  | { type: 'delegation'; action: 'started' | 'discarded' }
  | { type: 'retrieval'; outcome: VoiceResultKind | 'timeout' | 'error' | 'discarded'; durationMs: number }
  | { type: 'latency'; stage: 'output_verify'; outcome: 'verified' | 'aborted' | 'boundary' | 'timeout' | 'mismatch' | 'overflow'; durationMs: number; output?: VoiceOutputDiagnostics; missingAckOffset?: boolean }
  | { type: 'latency'; stage: 'input_to_delegation' | 'commentary_ack' | 'delegation_to_playback_allowed'; outcome: 'observed' | 'accepted' | 'rejected' | 'timeout'; durationMs: number }
  | VoiceRetrievalPhaseMetric;

export type LiveEvent =
  | { type: 'active' | 'standby' }
  | { type: 'transcript'; fragment: VoiceTranscriptFragment }
  | { type: 'output_audio'; frame: VoiceOutputFrame }
  | { type: 'delegation'; id: string; offsetMs: number }
  | { type: 'usage'; seconds: number }
  | { type: 'provider_error'; code: string }
  | { type: 'closed'; seconds?: number; reason?: VoiceCloseReason }
  | { type: 'commentary_accepted'; eventId: string; endMs?: number }
  | { type: 'commentary_rejected'; eventId: string };

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
  createSession(sdp: string, signal: AbortSignal, vocabulary?: VoiceVocabulary): Promise<{ id: string; sdp: string }>;
  attach(id: string, handlers: LiveHandlers, signal: AbortSignal): Promise<LiveSideband>;
  closeSession(id: string, sideband?: LiveSideband, onEvent?: LiveHandlers['onEvent']): Promise<void>;
}

export interface VoiceServiceOptions<Context, Facts, Prepared = unknown> {
  adapter: VoiceAdapter;
  authorize?(owner: VoiceOwner): Promise<boolean>;
  loadVocabulary?(owner: VoiceOwner, signal: AbortSignal): Promise<VoiceVocabulary | undefined>;
  prepare?(input: VoiceOwner & { text: string; context?: Context; signal: AbortSignal }): Promise<Prepared | undefined>;
  contextWithoutAudio?(context: Context): Context | undefined;
  retrieve(input: VoiceOwner & {
    text: string;
    history: VoiceTranscriptMessage[];
    context?: Context;
    prepared?: Prepared;
    signal: AbortSignal;
    observePhase?(metric: VoiceRetrievalPhaseMetric): void;
  }): Promise<VoiceResult<Facts> & { context?: Context }>;
  onMetric?(metric: VoiceMetric, turnId?: string): void;
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
  outputTimeoutMs?: number;
}
