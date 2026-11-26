import type { Task } from '../../shared/types'

export type TaskValues = Pick<Task, 'date' | 'title' | 'description' | 'projectId' | 'picId' | 'status'>
export type TaskErrors = Partial<Record<keyof TaskValues, string>>

export function initialTaskValues(task?: Task): TaskValues {
  return {
    date: task?.date ?? '',
    title: task?.title ?? '',
    description: task?.description ?? '',
    projectId: task?.projectId ?? '',
    picId: task?.picId ?? '',
    status: task?.status ?? 'pending',
  }
}

export function validateTask(values: TaskValues): TaskErrors {
  const errors: TaskErrors = {}
  if (!values.date) errors.date = 'Pilih tanggal'
  if (!values.title.trim()) errors.title = 'Masukkan judul tugas'
  if (values.title.trim().length > 120) errors.title = 'Gunakan maksimal 120 karakter'
  if (values.description.trim().length > 2000) errors.description = 'Gunakan maksimal 2000 karakter'
  if (!values.projectId) errors.projectId = 'Pilih proyek'
  if (!values.picId) errors.picId = 'Pilih PIC'
  return errors
}
