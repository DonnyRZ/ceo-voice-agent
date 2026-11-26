import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { api, ApiError } from '../../shared/api'
import { useSessionUser } from '../../shared/session'
import type { Member, Project, Task } from '../../shared/types'
import { TaskForm } from './task-form'
import { LoadState, TimesheetHeading } from './timesheet-ui'

export function TimesheetCreate() {
  return <TaskFormPage />
}

export function TimesheetEdit() {
  const { id } = useParams()
  return <TaskFormPage taskId={id} />
}

function TaskFormPage({ taskId }: { taskId?: string }) {
  const user = useSessionUser()
  const task = useQuery({ queryKey: ['task', taskId], queryFn: () => api<Task>(`/api/tasks/${taskId}`), enabled: Boolean(taskId) })
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api<Project[]>('/api/projects') })
  const members = useQuery({ queryKey: ['members'], queryFn: () => api<Member[]>('/api/members') })
  const failing = [projects, members, ...(taskId ? [task] : [])].find((query) => !query.data && query.isError)

  return (
    <section className="ts-page ts-form-page">
      <TimesheetHeading title={taskId ? 'Edit Tugas' : 'Tambah Tugas'} backTo={taskId ? `/timesheet/${taskId}` : '/timesheet'} />
      {failing ? (
        <LoadState error={failing.error instanceof ApiError && failing.error.status === 404 ? 'Tugas tidak ditemukan.' : 'Formulir belum dapat dimuat.'}
          retry={() => { void failing.refetch() }} />
      ) : !projects.data || !members.data || (taskId && !task.data) ? <LoadState /> : (
        <TaskForm key={taskId ?? 'create'} task={task.data} projects={projects.data} members={members.data} divisionName={user.divisionName} />
      )}
    </section>
  )
}
