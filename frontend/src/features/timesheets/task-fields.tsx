import { CalendarDays, ChevronDown, Flag, Layers3, Pencil, SquareMenu, UserRound, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Member, Project, Status } from '../../shared/types'
import { taskDate } from './task-dates'
import type { TaskErrors, TaskValues } from './task-values'
import { IconTile, StatusBadge, statusDetails, statuses } from './timesheet-ui'

interface FieldProps {
  name: keyof TaskValues
  label: string
  icon: LucideIcon
  error?: string
  children: (attributes: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode
}

function Field({ name, label, icon: Icon, error, children }: FieldProps) {
  const id = `ts-field-${name}`
  return (
    <div className={`ts-form-row ts-form-row--${name}${error ? ' ts-form-row--invalid' : ''}`}>
      <IconTile icon={Icon} className="ts-form-tile" />
      <label htmlFor={id}>{label}</label>
      <div className="ts-field-wrap">
        <Icon className="ts-input-icon" aria-hidden="true" />
        {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': error ? `${id}-error` : undefined })}
      </div>
      {error && <p className="ts-field-error" id={`${id}-error`}>{error}</p>}
    </div>
  )
}

interface TaskFieldsProps {
  editing: boolean
  values: TaskValues
  errors: TaskErrors
  onChange: <K extends keyof TaskValues>(name: K, value: TaskValues[K]) => void
  projects: Project[]
  members: Member[]
}

export function TaskFields({ editing, values, errors, onChange, projects, members }: TaskFieldsProps) {
  const title = (
    <Field name="title" label="Judul tugas" icon={Pencil} error={errors.title}>
      {(attrs) => <input {...attrs} value={values.title} onChange={(event) => onChange('title', event.target.value)} autoComplete="off" required />}
    </Field>
  )
  const description = (
    <Field name="description" label="Deskripsi" icon={SquareMenu} error={errors.description}>
      {(attrs) => <textarea {...attrs} rows={3} value={values.description} onChange={(event) => onChange('description', event.target.value)} />}
    </Field>
  )
  const date = (
    <Field name="date" label="Tanggal" icon={CalendarDays} error={errors.date}>
      {(attrs) => (
        <>
          <input {...attrs} type="date" lang="id" value={values.date} onChange={(event) => onChange('date', event.target.value)} required />
          <span className="ts-date-display" aria-hidden="true">{values.date ? taskDate(values.date) : 'Pilih tanggal'}</span>
        </>
      )}
    </Field>
  )

  return (
    <div className="ts-form-fields">
      {editing && date}
      {title}
      {description}
      {!editing && date}
      <Field name="projectId" label="Proyek" icon={Layers3} error={errors.projectId}>
        {(attrs) => (
          <>
            <select {...attrs} value={values.projectId} onChange={(event) => onChange('projectId', event.target.value)} required>
              <option value="">Pilih proyek</option>
              {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
            </select>
            <ChevronDown className="ts-select-chevron" aria-hidden="true" />
          </>
        )}
      </Field>
      <Field name="picId" label="PIC" icon={UserRound} error={errors.picId}>
        {(attrs) => (
          <>
            <select {...attrs} value={values.picId} onChange={(event) => onChange('picId', event.target.value)} required>
              <option value="">Pilih PIC</option>
              {members.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}
            </select>
            <ChevronDown className="ts-select-chevron" aria-hidden="true" />
          </>
        )}
      </Field>
      <Field name="status" label="Status" icon={editing ? statusDetails[values.status].icon : Flag} error={errors.status}>
        {(attrs) => (
          <>
            <div className={`ts-status-select ts-status--${values.status}`}>
              <select {...attrs} value={values.status} onChange={(event) => onChange('status', event.target.value as Status)} required>
                {statuses.map((status) => <option key={status} value={status}>{statusDetails[status].label}</option>)}
              </select>
              <span className="ts-status-display" aria-hidden="true"><StatusBadge status={values.status} /></span>
              <ChevronDown className="ts-select-chevron" aria-hidden="true" />
            </div>
            <div className="ts-status-options" role="radiogroup" aria-label="Status">
              {statuses.map((status) => {
                const { icon: Icon, label } = statusDetails[status]
                return (
                  <label key={status} className={`ts-status-option ts-status--${status}`}>
                    <Icon aria-hidden="true" /> {label}
                    <input type="radio" name="status" value={status} checked={values.status === status} onChange={() => onChange('status', status)} />
                  </label>
                )
              })}
            </div>
          </>
        )}
      </Field>
    </div>
  )
}
