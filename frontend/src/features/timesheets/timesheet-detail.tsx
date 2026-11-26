import { useQuery } from '@tanstack/react-query'
import { CalendarDays, ClipboardCheck, Layers3, Laptop, Pencil, SquareMenu, UserRound } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { api, ApiError } from '../../shared/api'
import { useSessionUser } from '../../shared/session'
import type { Task } from '../../shared/types'
import { taskDate } from './task-dates'
import { TaskHistory } from './task-history'
import { IconTile, LoadState, StatusBadge, statusDetails, TimesheetHeading } from './timesheet-ui'

export function TimesheetDetail() {
  const { id = '' } = useParams()
  const user = useSessionUser()
  const task = useQuery({ queryKey: ['task', id], queryFn: () => api<Task>(`/api/tasks/${id}`) })
  return (
    <section className="ts-page ts-detail">
      <TimesheetHeading title="Detail Tugas" />
      {task.isPending ? <LoadState /> : task.isError ? (
        <LoadState error={task.error instanceof ApiError && task.error.status === 404 ? 'Tugas tidak ditemukan.' : 'Detail tugas belum dapat dimuat.'}
          retry={() => { void task.refetch() }} />
      ) : (
        <>
          <TaskSummary task={task.data} />
          <TaskInformation task={task.data} divisionName={user.divisionName} />
          <TaskHistory taskId={task.data.id} />
          <EditTaskLink task={task.data} className="ts-mobile-edit" />
        </>
      )}
    </section>
  )
}

function TaskSummary({ task }: { task: Task }) {
  return (
    <div className="ts-banner ts-task-summary">
      <IconTile icon={ClipboardCheck} />
      <div className="ts-task-summary-text">
        <h2>{task.title}</h2>
        <div className="ts-summary-meta">
          <span><CalendarDays aria-hidden="true" /> <time dateTime={task.date}>{taskDate(task.date)}</time></span>
          <span><Layers3 aria-hidden="true" /> {task.projectName}</span>
          <span><UserRound aria-hidden="true" /> {task.picName}</span>
        </div>
        <div className="ts-summary-mobile-status"><StatusBadge status={task.status} /></div>
      </div>
      <div className="ts-summary-desktop-status"><StatusBadge status={task.status} showIcon /></div>
    </div>
  )
}

function TaskInformation({ task, divisionName }: { task: Task; divisionName: string }) {
  const detailRows = [
    { label: 'Judul Tugas', text: task.title, className: 'ts-info-desktop-only' },
    { label: 'Tanggal', text: taskDate(task.date), icon: CalendarDays, className: 'ts-info-date' },
    { label: 'Proyek', text: <Link to={`/projects/${task.projectId}`}>{task.projectName}</Link>, icon: Layers3, className: 'ts-info-project' },
    { label: 'Penanggung Jawab', text: task.picName, icon: UserRound, className: 'ts-info-pic' },
    { label: 'Status', text: <StatusBadge status={task.status} />, icon: statusDetails[task.status].icon, className: 'ts-info-desktop-only' },
    { label: 'Deskripsi', text: task.description || '—', icon: SquareMenu, className: 'ts-info-description' },
    { label: 'Divisi', text: divisionName, icon: Laptop, className: 'ts-info-mobile-only' },
  ]

  return (
    <section className="ts-card ts-task-info" aria-label="Informasi Tugas">
      <div className="ts-info-heading"><h2>Informasi Tugas</h2><EditTaskLink task={task} /></div>
      <dl>
        {detailRows.map(({ label, text, icon: Icon, className }) => (
          <div key={label} className={`ts-info-row ${className}`}>
            <dt>{Icon && <IconTile icon={Icon} className="ts-info-mobile-icon" />}{label}</dt>
            <dd>
              {Icon && <Icon className="ts-info-desktop-icon" aria-hidden="true" />}
              <span>{text}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function EditTaskLink({ task, className = '' }: { task: Task; className?: string }) {
  return (
    <Link className={`ts-button ts-button--primary ${className}`} to={`/timesheet/${task.id}/edit`}>
      <Pencil aria-hidden="true" /> Edit Tugas
    </Link>
  )
}
