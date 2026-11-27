import { useQuery } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { StatusBadge } from '../../../shared/ui';
import { CeoEmpty, CeoQueryProblem, CeoUpdatedAt } from '../shared/CeoElements';
import { ceoTaskHistoryQuery } from '../shared/ceo-data';

export function CeoTaskTimeline({ id }: { id: string }) {
  const history = useQuery(ceoTaskHistoryQuery(id));
  return <section className="ceo-surface ceo-task-history" aria-labelledby="ceo-status-history">
    <h2 id="ceo-status-history">Riwayat Status</h2>
    {history.isPending ? <CeoEmpty>Memuat riwayat…</CeoEmpty>
      : history.isError ? <CeoQueryProblem name="Riwayat status" error={history.error} retry={() => void history.refetch()} />
        : !history.data.length ? <CeoEmpty>Belum ada perubahan status tercatat.</CeoEmpty>
          : <ol className="ceo-history-list">
            {history.data.map((entry) => <li key={entry.id}>
              <StatusBadge status={entry.status} icon />
              <p><CalendarDays aria-hidden="true" /><CeoUpdatedAt value={entry.changedAt} /></p>
              {entry.actorName && <small>Oleh {entry.actorName}</small>}
            </li>)}
          </ol>}
    {history.data?.length === 50 && <p className="ceo-muted">Menampilkan 50 perubahan status terbaru.</p>}
  </section>;
}
