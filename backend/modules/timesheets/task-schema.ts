import { z } from 'zod';
import { editVersion, workStatus } from '../work-status.js';

const taskDate = z.iso.date({ error: 'Pilih tanggal yang valid.' })
  .refine((date) => !date.startsWith('0000-'), 'Pilih tanggal yang valid.');
const projectId = z.uuid({ error: 'Pilih proyek.' });
const picId = z.string({ error: 'Pilih PIC.' }).trim().min(1, 'Pilih PIC.').max(128);
const taskDescription = z.string().trim().max(2000, 'Maksimal 2.000 karakter.');

export const createTask = z.object({
  date: taskDate,
  title: z.string({ error: 'Masukkan judul tugas.' }).trim().min(1, 'Masukkan judul tugas.').max(120, 'Maksimal 120 karakter.'),
  description: taskDescription.default(''),
  projectId,
  picId,
  status: workStatus,
});

export const editTask = createTask.extend({
  description: taskDescription.optional(),
  version: editVersion,
});

export const taskFilters = z.object({
  from: taskDate.optional(),
  to: taskDate.optional(),
  projectId: projectId.optional(),
  picId: picId.optional(),
  status: workStatus.optional(),
}).refine(({ from, to }) => !from || !to || from <= to, {
  path: ['to'],
  error: 'Tanggal akhir harus sama atau setelah tanggal awal.',
});

export type TaskInput = z.infer<typeof createTask>;
export type TaskEdit = z.infer<typeof editTask>;
export type TaskFilters = z.infer<typeof taskFilters>;
