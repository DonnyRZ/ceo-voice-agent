import { z } from 'zod';
import { editVersion } from '../../work-status.js';

const divisionStatus = z.enum(['active', 'archived']);

export const divisionFilters = z.object({
  search: z.string().trim().max(120).optional(),
  status: divisionStatus.optional(),
});

export const divisionInput = z.object({
  name: z.string().trim().min(1, 'Masukkan nama divisi.').max(120, 'Maksimal 120 karakter.'),
  code: z.string().trim().regex(/^[\w-]{1,64}$/, 'Gunakan huruf, angka, garis bawah, atau tanda hubung.').optional(),
  description: z.string().trim().min(1, 'Masukkan deskripsi.').max(2000, 'Maksimal 2.000 karakter.'),
});

export const divisionEdit = divisionInput.extend({ version: editVersion });
export const archiveVersion = z.object({ version: z.coerce.number().pipe(editVersion).optional() });

export type DivisionStatus = z.infer<typeof divisionStatus>;
export type DivisionFilters = z.infer<typeof divisionFilters>;
export type DivisionInput = z.infer<typeof divisionInput>;
export type DivisionEdit = z.infer<typeof divisionEdit>;
