import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Clock3 } from 'lucide-react'
import { api } from '../../shared/api'
import type { Status } from '../../shared/types'
import { taskTime } from './task-dates'
import { IconTile, LoadState, StatusBadge } from './timesheet-ui'

interface HistoryEntry {
  id: string
  changedAt: string
  previousStatus: Status
  status: Status
}

export function TaskHistory({ taskId }: { taskId: string }) {
  const history = useQuery({ queryKey: ['task-history', taskId], queryFn: () => api<HistoryEntry[]>(`/api/tasks/${taskId}/history`) })

  return (
    <section className="ts-card ts-history" aria-labelledby="ts-history-title">
      <h2 id="ts-history-title">Riwayat Perubahan</h2>
      {history.isPending ? <LoadState /> : history.isError ? (
        <LoadState error="Riwayat belum dapat dimuat." retry={() => { void history.refetch() }} />
      ) : !history.data.length ? (
        <p className="ts-history-empty">Belum ada perubahan status.</p>
      ) : (
        <>
          <div className="ts-history-table">
            <table className="ts-table" aria-label="Riwayat perubahan status">
              <thead><tr><th scope="col">Waktu</th><th scope="col">Status Sebelumnya</th><th scope="col">Status Sesudahnya</th></tr></thead>
              <tbody>{history.data.map((entry) => (
                <tr key={entry.id}>
                  <td><time dateTime={entry.changedAt}>{taskTime(entry.changedAt)}</time></td>
                  <td><StatusBadge status={entry.previousStatus} showIcon /></td>
                  <td><StatusBadge status={entry.status} showIcon /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="ts-mobile-history">
            {history.data.map((entry) => (
              <div className="ts-card ts-mobile-history-entry" key={entry.id}>
                <IconTile icon={Clock3} />
                <div>
                  <div className="ts-history-transition">
                    <StatusBadge status={entry.previousStatus} />
                    <ArrowRight size={19} aria-hidden="true" />
                    <StatusBadge status={entry.status} />
                  </div>
                  <time dateTime={entry.changedAt}>{taskTime(entry.changedAt)}</time>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
