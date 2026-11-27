import { z } from 'zod';
import { editVersion } from '../../work-status.js';

export const accountRole = z.enum(['member', 'superadmin', 'ceo']);
const accountStatus = z.enum(['active', 'pending', 'failed', 'revoked', 'expired']);
const divisionId = z.uuid({ error: 'Pilih divisi yang tersedia.' });
const name = z.string({ error: 'Masukkan nama.' }).trim().min(1, 'Masukkan nama.').max(120);
const email = z.string().trim().toLowerCase().max(254).pipe(z.email({ error: 'Masukkan email perusahaan yang valid.' }));

const access = z.object({
  role: accountRole,
  divisionId: divisionId.nullable().default(null),
});

function validDivision({ role, divisionId }: z.infer<typeof access>) {
  return role === 'member' ? Boolean(divisionId) : divisionId === null;
}

const divisionRequirement = { path: ['divisionId'], error: 'Pilih divisi yang sesuai dengan peran.' };

export const editUser = access.extend({ name: name.optional(), version: editVersion })
  .refine(validDivision, divisionRequirement);
export const createInvitation = access.extend({ email }).refine(validDivision, divisionRequirement);
export const versionCheck = z.object({ version: editVersion.optional() });
export const userFilters = z.object({
  search: z.string().trim().max(120).optional(),
  role: accountRole.optional(),
  divisionId: divisionId.optional(),
  status: accountStatus.optional(),
});

export const activation = z.object({
  token: z.string().regex(/^[a-zA-Z0-9_-]{43}$/, 'Tautan aktivasi tidak valid.'),
  name,
  password: z.string({ error: 'Masukkan kata sandi.' })
    .min(8, 'Kata sandi minimal 8 karakter.').max(128, 'Kata sandi maksimal 128 karakter.'),
});

export type AccountRole = z.infer<typeof accountRole>;
export type AccountStatus = z.infer<typeof accountStatus>;
export type UserFilters = z.infer<typeof userFilters>;
export type UserEdit = z.infer<typeof editUser>;
export type InvitationInput = z.infer<typeof createInvitation>;
