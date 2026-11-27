import { z } from 'zod';
import { periodFields, validPeriod } from '../admin/reports/report-period.js';

export const ceoDivisionFilters = z.object({
  ...periodFields,
  search: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'archived']).optional(),
}).refine(validPeriod.check, validPeriod.error);

export type CeoDivisionFilters = z.infer<typeof ceoDivisionFilters>;
