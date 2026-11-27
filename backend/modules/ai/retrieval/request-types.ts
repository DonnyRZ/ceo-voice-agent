import type { WorkStatus } from '../../work-status.js';
import type { CeoEntity, CeoIntent, CeoPeriod } from './schema.js';

export type WorkKind = 'project' | 'task';
export type DivisionRef = { id: string; name: string; code: string };

export interface CeoRequest {
  intent: CeoIntent;
  subject?: string;
  entityKind?: WorkKind;
  entity?: CeoEntity;
  division?: DivisionRef;
  period?: CeoPeriod;
  asOf?: string;
  statuses?: WorkStatus[];
  focusUpdatedAt?: boolean;
  latest: boolean;
}

export interface CeoRetrievalContext {
  request?: CeoRequest;
  choices?: CeoEntity[];
}
