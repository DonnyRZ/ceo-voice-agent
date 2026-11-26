import { z } from 'zod';

export const workStatus = z.enum(['pending', 'on_progress', 'done'], {
  error: 'Pilih status yang tersedia.',
});

export const editVersion = z.number().int().positive().max(2_147_483_647);
export type WorkStatus = z.infer<typeof workStatus>;
