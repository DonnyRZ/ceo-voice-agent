import type { WorkStatus } from '../../work-status.js';
import type { CeoEntity, CeoIntent, CeoPeriod } from './schema.js';

export type WorkKind = 'project' | 'task';
export type DivisionRef = { id: string; name: string; code: string };
export type PresentedChoice = CeoEntity & { divisionId: string };
export type SummaryDetail = 'total' | 'breakdown';

export interface CeoRequest {
  intent: CeoIntent;
  subject?: string;
  entityKind?: WorkKind;
  entity?: CeoEntity;
  entityDivisionId?: string;
  division?: DivisionRef;
  period?: CeoPeriod;
  asOf?: string;
  statuses?: WorkStatus[];
  summaryDetail?: SummaryDetail;
  focusUpdatedAt?: boolean;
  latest: boolean;
}

export interface CeoRetrievalContext {
  request?: CeoRequest;
  pendingRequest?: CeoRequest;
  choices?: PresentedChoice[];
  needsConfirmation?: boolean;
}
