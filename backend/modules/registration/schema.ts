import { z } from 'zod';

export const registrationInput = z.object({
  name: z.string().trim().min(2, 'Isi nama lengkap.').max(120),
  email: z.email('Email tidak valid.').max(254).transform((email) => email.toLowerCase()),
  divisionId: z.uuid('Pilih divisi yang tersedia.'),
  password: z.string().min(8, 'Minimal 8 karakter.').max(128, 'Maksimal 128 karakter.'),
}).strict();

export const verificationInput = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type RegistrationStatus = { name: string; email: string; division_id: string; verified: boolean; delivery: string };
