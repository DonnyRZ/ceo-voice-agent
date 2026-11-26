import { z } from 'zod';

const date = z.iso.date({ error: 'Pilih tanggal yang valid.' })
  .refine((value) => !value.startsWith('0000-'), 'Pilih tanggal yang valid.');

export const periodFields = { from: date.optional(), to: date.optional() };

export const validPeriod = {
  check: ({ from, to }: { from?: string; to?: string }) => !from || !to || from <= to,
  error: { path: ['to'], error: 'Tanggal akhir harus sama atau setelah tanggal awal.' },
};

export const reportPeriod = z.object(periodFields).refine(validPeriod.check, validPeriod.error);
export type ReportPeriod = z.infer<typeof reportPeriod>;
