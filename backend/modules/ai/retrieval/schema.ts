import type { QueryResultRow } from 'pg';
import { z } from 'zod';
import { workStatus } from '../../work-status.js';

export interface RetrievalDatabase {
  query<Row extends QueryResultRow>(sql: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
  withSnapshot?<T>(run: (db: RetrievalDatabase) => Promise<T>): Promise<T>;
}

export const ceoIntent = z.enum(['status', 'pic', 'summary', 'history']);
export const ceoEntity = z.object({
  kind: z.enum(['project', 'task', 'division']),
  id: z.string().uuid(),
  name: z.string().min(1),
  divisionName: z.string().optional(),
});
export const ceoPeriod = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() });
const timestamp = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();

export const ceoTaskFact = z.object({
  id: z.string().uuid(), title: z.string().min(1),
  projectId: z.string().uuid(), projectName: z.string().min(1),
  divisionId: z.string().uuid(), divisionName: z.string().min(1),
  date: z.iso.date(), status: workStatus, picName: z.string().min(1).nullable(), updatedAt: timestamp,
});

export const ceoStatusEvent = z.object({
  id: z.string().min(1), changedAt: timestamp,
  previousStatus: workStatus.nullable(), status: workStatus, actorName: z.string().nullable(),
});

export const ceoFactSchema = z.object({
  intent: ceoIntent,
  entity: ceoEntity.optional(),
  period: ceoPeriod.optional(),
  asOf: timestamp.optional(),
  status: workStatus.optional(),
  updatedAt: timestamp.optional(),
  focusUpdatedAt: z.boolean().optional(),
  counts: z.object({ pending: count, on_progress: count, done: count, total: count }).optional(),
  statusFilter: z.array(workStatus).max(3).optional(),
  tasks: z.array(ceoTaskFact).max(12),
  history: z.array(ceoStatusEvent).max(12),
  evidenceId: z.string().optional(),
  picName: z.string().min(1).nullable().optional(),
});

export type CeoIntent = z.infer<typeof ceoIntent>;
export type CeoEntity = z.infer<typeof ceoEntity>;
export type CeoPeriod = z.infer<typeof ceoPeriod>;
export type CeoFacts = z.infer<typeof ceoFactSchema>;
export type CeoTaskFact = z.infer<typeof ceoTaskFact>;
export type CountFact = NonNullable<CeoFacts['counts']>;
