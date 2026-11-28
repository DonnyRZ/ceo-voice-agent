import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Laptop, Save, TriangleAlert } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../shared/api'
import type { Member, Project, Task } from '../../shared/types'
import { TaskConflict } from './task-conflict'
import { TaskFields } from './task-fields'
import { initialTaskValues, validateTask, type TaskErrors, type TaskValues } from './task-values'
import { IconTile } from './timesheet-ui'

interface TaskFormProps {
  task?: Task
  projects: Project[]
  members: Member[]
  divisionName: string
}

export function TaskForm({ task, projects, members, divisionName }: TaskFormProps) {
  const [original] = useState(task)
  const [values, setValues] = useState(() => initialTaskValues(task))
  const [errors, setErrors] = useState<TaskErrors>({})
  const [failed, setFailed] = useState(false)
  const [conflicted, setConflicted] = useState(false)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const editing = Boolean(original)
  const cancelPath = original ? `/timesheet/${original.id}` : '/timesheet'
  const title = editing ? 'Edit Tugas' : 'Tambah Tugas'

  const save = useMutation({
    mutationFn: (draft: TaskValues) => api<Task>(original ? `/api/tasks/${original.id}` : '/api/tasks', {
      method: original ? 'PATCH' : 'POST',
      body: JSON.stringify(original ? { ...draft, version: original.version } : draft),
    }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['task', saved.id], saved)
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      void queryClient.invalidateQueries({ queryKey: ['task-history', saved.id] })
      navigate(`/timesheet/${saved.id}`, { replace: true })
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409 && original) {
        setConflicted(true)
      } else if (error instanceof ApiError && Object.keys(error.fields).length) {
        setErrors(error.fields)
      } else {
        setFailed(true)
      }
    },
  })

  function change<K extends keyof TaskValues>(name: K, value: TaskValues[K]) {
    setValues((previous) => ({ ...previous, [name]: value }))
    setErrors((previous) => ({ ...previous, [name]: undefined }))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (save.isPending) return
    const violations = validateTask(values)
    setErrors(violations)
    const firstField = Object.keys(violations)[0]
    if (firstField) {
      document.getElementById(`ts-field-${firstField}`)?.focus()
      return
    }
    save.mutate(values)
  }

  if (conflicted && original) return <TaskConflict task={original} draft={values} projects={projects} />

  const invalid = Object.values(errors).some(Boolean)
  return (
    <>
      <div className={`ts-banner ts-form-context${failed ? ' ts-form-context--hidden' : ''}${!editing && !invalid ? ' ts-form-context--new' : ''}`}>
        <IconTile icon={Laptop} />
        <div><span>Anggota Divisi</span>{' '}<strong>{divisionName}</strong></div>
      </div>
      {failed && <div className="ts-save-warning" role="alert"><TriangleAlert aria-hidden="true" />Perubahan belum tersimpan.</div>}
      <form onSubmit={submit} noValidate className={`ts-card ts-form ${editing ? 'ts-form--edit' : 'ts-form--new'}`}>
        {!editing && !failed && <p className="ts-form-card-title">{title}</p>}
        <TaskFields editing={editing} values={values} errors={errors} onChange={change} projects={projects} members={members} />
        <div className="ts-form-actions">
          <Link className="ts-button ts-button--secondary ts-cancel-button" to={cancelPath}>Batal</Link>
          <button className="ts-button ts-button--primary" type="submit" disabled={save.isPending}>
            {!save.isPending && <Save className="ts-save-icon" aria-hidden="true" />}
            {save.isPending ? <span className="loading-inline" aria-live="polite"><span className="ui-spinner" aria-hidden="true" />Menyimpan</span> : failed ? 'Coba simpan lagi' : editing ? 'Simpan perubahan' : 'Simpan tugas'}
          </button>
        </div>
      </form>
    </>
  )
}
