import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Laptop, Plus, SquarePlus, UserRound } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../shared/api'
import { useSessionUser } from '../../shared/session'
import type { Member, Project, Task } from '../../shared/types'
import { emptyFilters, filterSearch, FilterSelect, ListFilters } from './list-filters'
import { currentMonth, monthName, recentMonths } from './task-dates'
import { TaskListResults } from './task-list-results'
import { IconTile, LoadState, StatusBadge, statusDetails, statuses, TimesheetHeading } from './timesheet-ui'

export function TimesheetList() {
  const user = useSessionUser()
  const [filters, setFilters] = useState(emptyFilters)
  const search = filterSearch(filters)
  const all = useQuery({ queryKey: ['tasks'], queryFn: () => api<Task[]>('/api/tasks') })
  const filtered = useQuery({
    queryKey: ['tasks', search],
    queryFn: () => api<Task[]>(`/api/tasks?${search}`),
    enabled: search !== '',
  })
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api<Project[]>('/api/projects') })
  const members = useQuery({ queryKey: ['members'], queryFn: () => api<Member[]>('/api/members') })

  const tasks = all.data ?? []
  const rows = (search ? filtered.data : all.data) ?? []
  const isEmpty = all.isSuccess && tasks.length === 0
  const noResults = Boolean(search && filtered.isSuccess && tasks.length && !rows.length)
  const failing = [all, projects, members, ...(search ? [filtered] : [])].find((query) => query.isError)
  const months = recentMonths(tasks.map((task) => task.date.slice(0, 7)))
  const mobileLead = isEmpty ? <p className="ts-mobile-role">Anggota Divisi {user.divisionName}</p>
    : noResults ? <p className="ts-mobile-role ts-mobile-role--banner"><UserRound size={25} aria-hidden="true" />Anggota Divisi {user.divisionName}</p>
    : undefined

  return (
    <section className={`ts-page ts-list${isEmpty ? ' ts-list--empty' : ''}${noResults ? ' ts-list--no-results' : ''}`}>
      <TimesheetHeading title="Timesheet Divisi" division={user.divisionName} backTo="/" mobileLead={mobileLead} />

      {!noResults && <div className="ts-banner ts-list-banner">
        <IconTile icon={CalendarDays} className="ts-list-calendar" />
        <IconTile icon={Laptop} className="ts-list-laptop" />
        {isEmpty ? (
          <>
            <div className="ts-list-empty-division"><strong>{user.divisionName}</strong><span>{monthName(filters.period || currentMonth())}</span></div>
            <FilterSelect label="Periode" icon={CalendarDays} value={filters.period || currentMonth()}
              onChange={(period) => setFilters({ ...filters, period })}>
              {months.map((month) => <option key={month} value={month}>{monthName(month)}</option>)}
            </FilterSelect>
          </>
        ) : (
          <>
            <strong className="ts-desktop-banner-title">Timesheet Divisi</strong>
            <div className="ts-list-mobile-division"><span>Divisi</span><strong>{user.divisionName}</strong></div>
            <div className="ts-list-mobile-role"><span>Peran</span><strong>Anggota Divisi</strong></div>
          </>
        )}
      </div>}

      {(isEmpty || noResults) && <TaskCounts tasks={tasks} />}

      {!isEmpty && <div className="ts-list-toolbar">
        <ListFilters value={filters} onChange={setFilters} months={months} projects={projects.data ?? []} members={members.data ?? []} compact={noResults} />
        {!noResults && <CreateTaskLink />}
      </div>}
      {noResults && (
        <div className="ts-mobile-results-filter" aria-label="Filter status">
          <strong>Status</strong>
          <div>{statuses.map((status) => (
            <button key={status} type="button" aria-pressed={status === filters.status} onClick={() => setFilters({ ...filters, status: status === filters.status ? '' : status })}>
              <StatusBadge status={status} />
            </button>
          ))}</div>
        </div>
      )}

      {failing ? <LoadState error="Timesheet belum dapat dimuat." retry={() => { void failing.refetch() }} />
        : all.isPending || (search && filtered.isPending) ? <LoadState />
        : isEmpty ? (
          <div className="ts-card ts-empty-card"><EmptyIllustration /><strong>Belum ada tugas</strong><CreateTaskLink /></div>
        ) : (
          <TaskListResults tasks={rows} empty={(
            <div className="ts-empty-card ts-empty-card--filtered">
              <EmptyIllustration filtered />
              <strong>Tidak ada tugas yang cocok</strong>
              <button className="ts-button ts-button--mint" onClick={() => setFilters(emptyFilters)}>Hapus filter</button>
            </div>
          )} />
        )}
    </section>
  )
}

function CreateTaskLink() {
  return (
    <Link className="ts-button ts-button--primary ts-create-link" to="/timesheet/new">
      <Plus className="ts-desktop-plus" aria-hidden="true" />
      <SquarePlus className="ts-mobile-plus" aria-hidden="true" />
      Tambah tugas
    </Link>
  )
}

function EmptyIllustration({ filtered = false }: { filtered?: boolean }) {
  return (
    <div className="ts-empty-illustration">
      <img src={filtered ? '/images/timesheet-no-results.png' : '/images/timesheet-empty.png'} alt="" />
    </div>
  )
}

function TaskCounts({ tasks }: { tasks: Task[] }) {
  return (
    <div className="ts-counts" aria-label="Ringkasan status tugas">
      {statuses.map((status) => {
        const { icon: Icon } = statusDetails[status]
        return (
          <div className={`ts-count ts-status--${status}`} key={status}>
            <Icon aria-hidden="true" />
            <div><strong>{tasks.filter((task) => task.status === status).length}</strong><StatusBadge status={status} /></div>
          </div>
        )
      })}
    </div>
  )
}
