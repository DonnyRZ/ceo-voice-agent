import { z } from 'zod';

export const registrationInput = z.object({
  name: z.string().trim().min(2, 'Isi nama lengkap.').max(120),
  email: z.email('Email tidak valid.').max(254).transform((email) => email.toLowerCase()),
  divisionId: z.uuid('Pilih divisi yang tersedia.'),
  password: z.string().min(8, 'Minimal 8 karakter.').max(128, 'Maksimal 128 karakter.'),
  originDevice: z.enum(['mobile', 'desktop']),
}).strict();

export const verificationInput = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/),
  password: z.string().min(8).max(128).optional() }).strict();
export const progressInput = z.object({ step: z.enum(['device','android-install','android-wait','iphone-share','iphone-add','iphone-open']) }).strict();
export const completionInput = z.object({ method: z.enum(['android-installed','standalone','iphone-confirmed']) }).strict();
export type RegistrationStatus = { name: string; email: string; division_id: string; verified: boolean; delivery: string;
  origin_device: 'mobile' | 'desktop' | null; resend_after: string | null; sends_remaining: number;
  completed: boolean; step: string };
