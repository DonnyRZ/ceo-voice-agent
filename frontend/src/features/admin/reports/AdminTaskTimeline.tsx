import { useQuery } from '@tanstack/react-query';
import { LoadProblem, StatusBadge } from '../../../shared/ui';
import { displayAuditDay } from '../audit/audit-data';
import { adminTaskHistoryQuery } from './report-data';

export function AdminTaskTimeline({ id }: { id: string }) {
  const history = useQuery(adminTaskHistoryQuery(id));
  const entries = history.data ? [...history.data].reverse() : [];
  const oldest = entries[0];
  const timeline = oldest ? [
    { id: `initial-${oldest.id}`, status: oldest.previousStatus, changedAt: null },
    ...entries,
  ] : [];

  return (
    <section className="admin-surface admin-timeline" aria-labelledby="admin-task-timeline-title">
      <h2 id="admin-task-timeline-title">Riwayat status</h2>
      {history.isPending ? <p role="status"><span className="loading-inline"><span className="ui-spinner" aria-hidden="true" />Memuat riwayat</span></p>
        : history.isError ? <LoadProblem title="Riwayat belum dapat dimuat." retry={() => void history.refetch()} />
        : timeline.length === 0 ? <p className="admin-notice">Belum ada perubahan status.</p>
        : <>
          <table className="admin-data-table admin-timeline-table" aria-label="Riwayat status">
            <thead><tr><th scope="col">No.</th><th scope="col">Status</th><th scope="col">Tanggal</th></tr></thead>
            <tbody>
              {timeline.map(({ id: entryId, status, changedAt }, index) => (
                <tr key={entryId}><td>{index + 1}</td><td><StatusBadge status={status} icon /></td>
                  <td>{changedAt ? <time dateTime={changedAt}>{displayAuditDay(changedAt)}</time> : '—'}</td></tr>
              ))}
            </tbody>
          </table>
          <ol className="admin-timeline-list">
            {timeline.map(({ id: entryId, status }) => (
              <li key={entryId} className={`admin-timeline-${status}`}><StatusBadge status={status} /></li>
            ))}
          </ol>
        </>}
    </section>
  );
}
