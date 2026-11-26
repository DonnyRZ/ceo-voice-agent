import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Info, Laptop, SquareMenu } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../shared/api'
import type { Project, Task } from '../../shared/types'
import { taskDate } from './task-dates'
import type { TaskValues } from './task-values'
import { IconTile, LoadState, StatusBadge } from './timesheet-ui'

export function TaskConflict({ task, draft, projects }: { task: Task; draft: TaskValues; projects: Project[] }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const latest = useQuery({
    queryKey: ['task-conflict', task.id, task.version],
    queryFn: () => api<Task>(`/api/tasks/${task.id}`),
    gcTime: 0,
  })

  return (
    <>
      <div className="ts-banner ts-conflict-banner" role="alert">
        <IconTile icon={Info} />
        <div><strong>Tugas sudah diperbarui pengguna lain.</strong><p>Tinjau versi terbaru.</p></div>
      </div>
      {latest.isPending ? <LoadState /> : latest.isError ? (
        <LoadState error="Versi terbaru belum dapat dimuat." retry={() => { void latest.refetch() }} />
      ) : (
        <>
          <div className="ts-card ts-conflict-description"><IconTile icon={SquareMenu} /><div><span>Deskripsi</span><strong>{draft.description || '—'}</strong></div></div>
          <div className="ts-card ts-conflict-statuses">
            <div className="ts-conflict-task"><IconTile icon={Laptop} /><div><strong>{latest.data.title}</strong><p>{latest.data.projectName}</p></div></div>
            <p className={`ts-status--${draft.status}`}><span>Isian Anda:</span><StatusBadge status={draft.status} /></p>
            <p className={`ts-status--${latest.data.status}`}><span>Versi terbaru:</span><StatusBadge status={latest.data.status} /></p>
          </div>
          <section className="ts-card ts-conflict-review" aria-label="Perbandingan versi tugas">
            <h2>Tinjau versi terbaru.</h2>
            <table className="ts-table">
              <thead><tr><th scope="col">Data</th><th scope="col">Isian Anda</th><th scope="col">Versi terbaru</th></tr></thead>
              <tbody>
                <tr><th scope="row">Tanggal</th><td>{taskDate(draft.date)}</td><td>{taskDate(latest.data.date)}</td></tr>
                <tr><th scope="row">Proyek</th><td>{projects.find((project) => project.id === draft.projectId)?.name ?? task.projectName}</td><td>{latest.data.projectName}</td></tr>
                <tr><th scope="row">Tugas</th><td>{draft.title}</td><td>{latest.data.title}</td></tr>
                <tr><th scope="row">Status</th><td><StatusBadge status={draft.status} /></td><td><StatusBadge status={latest.data.status} /></td></tr>
              </tbody>
            </table>
            <button className="ts-button ts-button--primary" onClick={() => {
              queryClient.setQueryData(['task', task.id], latest.data)
              void queryClient.invalidateQueries({ queryKey: ['task-history', task.id] })
              void queryClient.invalidateQueries({ queryKey: ['tasks'] })
              navigate(`/timesheet/${task.id}`, { replace: true })
            }}>Tinjau versi terbaru</button>
          </section>
        </>
      )}
    </>
  )
}
