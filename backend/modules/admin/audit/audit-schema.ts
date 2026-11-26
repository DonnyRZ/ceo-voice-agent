import { z } from 'zod';
import { ApiError } from '../../../http/api-error.js';
import { periodFields, validPeriod } from '../reports/report-period.js';

export const auditTables = {
  task: 'tasks',
  project: 'projects',
  division: 'divisions',
  member: 'members',
  access: 'account_access',
  invitation: 'invitations',
} as const;

const auditAction = z.enum(['INSERT', 'UPDATE', 'DELETE']);
const auditEntity = z.enum(Object.keys(auditTables) as [keyof typeof auditTables, ...(keyof typeof auditTables)[]]);

export const auditFilters = z.object({
  ...periodFields,
  actor: z.string().trim().min(1).max(254).optional(),
  action: auditAction.optional(),
  entity: auditEntity.optional(),
  divisionId: z.uuid().optional(),
}).refine(validPeriod.check, validPeriod.error);

export function auditId(value: string) {
  if (!/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9_223_372_036_854_775_807n) {
    throw new ApiError(404, 'Perubahan tidak ditemukan.');
  }
  return value;
}

export type AuditFilters = z.infer<typeof auditFilters>;
export type AuditAction = z.infer<typeof auditAction>;
export type AuditEntity = z.infer<typeof auditEntity>;
