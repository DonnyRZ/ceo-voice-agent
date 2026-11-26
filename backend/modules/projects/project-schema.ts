import { z } from 'zod';
import { editVersion, workStatus } from '../work-status.js';

const projectDescription = z.string().trim().max(2000, 'Maksimal 2.000 karakter.');
export const createProject = z.object({
  name: z.string({ error: 'Masukkan nama proyek.' }).trim().min(1, 'Masukkan nama proyek.').max(120, 'Maksimal 120 karakter.'),
  description: projectDescription.default(''),
  status: workStatus.optional(),
});

export const editProject = createProject.extend({
  description: projectDescription.optional(),
  version: editVersion,
});
export type ProjectInput = z.infer<typeof createProject>;
export type ProjectEdit = z.infer<typeof editProject>;
