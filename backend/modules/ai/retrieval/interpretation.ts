import { z } from 'zod';
import { workStatus } from '../../work-status.js';
import type { VoiceTranscriptMessage } from '../voice/transcript.js';
import type { CeoRetrievalContext, DivisionRef } from './request-types.js';

const scopeChanges = z.array(z.enum(['division', 'period', 'asOf', 'statuses'])).max(4);
const divisionExcerpt = z.string().min(1).max(250).nullable();
const summaryDetail = z.enum(['total', 'breakdown']).nullable();
const inlineCorrection = z.strictObject({
  supersededSubject: z.string().min(1).max(250),
  bridge: z.string().min(1).max(160),
}).nullable();
const interpretationFields = {
  kind: z.enum(['lookup', 'select_candidate', 'clarify', 'unsupported']),
  operation: z.enum(['status', 'pic', 'updated_at', 'summary', 'history']).nullable(),
  target: z.enum(['named_work', 'previous_work', 'latest_work', 'division_or_company']).nullable(),
  subject: z.string().min(1).max(250).nullable(),
  workKind: z.enum(['project', 'task']).nullable(),
  divisionId: z.uuid().nullable(),
  from: z.iso.date().nullable(),
  to: z.iso.date().nullable(),
  asOf: z.iso.date().nullable(),
  statuses: z.array(workStatus).max(3),
  selectionId: z.uuid().nullable(),
  clarify: z.enum(['project_or_task', 'division', 'period', 'operation']).nullable(),
};

export const ceoInterpretation = z.strictObject({ ...interpretationFields,
  clear: scopeChanges.optional(), correction: inlineCorrection.optional(), divisionExcerpt: divisionExcerpt.optional(),
  summaryDetail: summaryDetail.optional(),
});
export const ceoProviderInterpretation = z.strictObject({ ...interpretationFields,
  clear: scopeChanges, correction: inlineCorrection, divisionExcerpt, summaryDetail,
});

export type CeoInterpretation = z.infer<typeof ceoInterpretation>;

export interface IntentResponseMetadata {
  model: string;
  serviceTier?: string;
  reasoningTokens?: number;
  responseStatus?: string;
  incompleteReason?: string;
  outputTokens?: number;
  validation?: 'aborted' | 'incomplete' | 'missing_output' | 'invalid_json' | 'invalid_schema' | 'valid';
  responseErrorCode?: string;
  outputTypes?: string[];
  outputPhases?: string[];
  validationIssues?: Array<{ code: string; path: string }>;
}

export type InterpretCeoTurn = (input: {
  transcript: string;
  history: readonly VoiceTranscriptMessage[];
  context?: CeoRetrievalContext;
  divisions: DivisionRef[];
  currentTitleHints?: readonly string[];
  scopeRecheck?: { provisional: CeoInterpretation; registeredTitle: string };
  today: string;
  signal?: AbortSignal;
  observe?(details: IntentResponseMetadata): void;
}) => Promise<CeoInterpretation>;
