import { CalendarDays, ChevronDown, Layers3, Tag, UserRound, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Member, Project, Status } from '../../shared/types'
import { monthName, monthRange } from './task-dates'
import { statusDetails, statuses } from './timesheet-ui'

export interface TaskFilters {
  period: string
  projectId: string
  picId: string
  status: Status | ''
}

export const emptyFilters: TaskFilters = { period: '', projectId: '', picId: '', status: '' }

export function filterSearch(filters: TaskFilters) {
  const query = new URLSearchParams()
  if (filters.period) {
    const { from, to } = monthRange(filters.period)
    query.set('from', from)
    query.set('to', to)
  }
  if (filters.projectId) query.set('projectId', filters.projectId)
  if (filters.picId) query.set('picId', filters.picId)
  if (filters.status) query.set('status', filters.status)
  return query.toString()
}

interface FilterSelectProps {
  label: string
  icon: LucideIcon
  value: string
  onChange: (value: string) => void
  children: ReactNode
}

export function FilterSelect({ label, icon: Icon, value, onChange, children }: FilterSelectProps) {
  return (
    <div className="ts-filter-select">
      <Icon className="ts-filter-icon" size={20} aria-hidden="true" />
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
      <ChevronDown className="ts-select-chevron" size={19} aria-hidden="true" />
    </div>
  )
}

interface ListFiltersProps {
  value: TaskFilters
  onChange: (filters: TaskFilters) => void
  months: string[]
  projects: Project[]
  members: Member[]
  compact?: boolean
}

export function ListFilters({ value, onChange, months, projects, members, compact = false }: ListFiltersProps) {
  return (
    <div className="ts-filter-grid" aria-label="Filter timesheet">
      {(!compact || value.period) && <FilterSelect label="Periode" icon={CalendarDays} value={value.period} onChange={(period) => onChange({ ...value, period })}>
        <option value="">Periode</option>
        {months.map((month) => <option key={month} value={month}>{monthName(month)}</option>)}
      </FilterSelect>}
      {(!compact || value.projectId) && <FilterSelect label="Proyek" icon={Layers3} value={value.projectId} onChange={(projectId) => onChange({ ...value, projectId })}>
        <option value="">Proyek</option>
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </FilterSelect>}
      {(!compact || value.picId) && <FilterSelect label="PIC" icon={UserRound} value={value.picId} onChange={(picId) => onChange({ ...value, picId })}>
        <option value="">PIC</option>
        {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
      </FilterSelect>}
      <FilterSelect label="Status" icon={Tag} value={value.status} onChange={(status) => onChange({ ...value, status: status as TaskFilters['status'] })}>
        <option value="">Status</option>
        {statuses.map((status) => <option key={status} value={status}>{statusDetails[status].label}</option>)}
      </FilterSelect>
    </div>
  )
}
