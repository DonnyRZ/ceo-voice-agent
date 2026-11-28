import { useQuery } from '@tanstack/react-query';
import { Calendar, ChevronRight, FileText, Layers, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LoadProblem } from '../../../shared/ui';
import { monthName, monthRange, recentMonths } from '../../timesheets/task-dates';
import { adminDivisionsQuery } from '../divisions/division-data';
import { namedOptions } from '../reports/ReportFilters';
import { validMonth } from '../reports/report-data';
import { AdminBanner, AdminFilter } from '../shell/AdminElements';
import { AdminEmptyState } from '../shell/AdminEmptyState';
import { AdminPageHeader } from '../shell/AdminPageHeader';
import { useAdminSearchFilters } from '../shell/useAdminSearchFilters';
import { adminAuditQuery, auditActor, auditDateTime, auditDescription, auditMonthKey, type AdminAudit } from './audit-data';
import './admin-audit.css';

const actions = [
  { value: 'INSERT', label: 'Penambahan' },
  { value: 'UPDATE', label: 'Perubahan' },
  { value: 'DELETE', label: 'Penghapusan' },
];

function AuditEntries({ entries, backQuery }: { entries: AdminAudit[]; backQuery: string }) {
  const link = (entry: AdminAudit) => `/admin/audit/${entry.id}`;
  return (
    <>
      <section className="admin-surface admin-audit-desktop">
        <table className="admin-data-table" aria-label="Daftar perubahan audit">
          <thead><tr><th scope="col">Tanggal &amp; Waktu</th><th scope="col">Pengguna</th><th scope="col">Divisi</th><th scope="col">Jenis tindakan</th></tr></thead>
          <tbody>{entries.map((entry) => (
            <tr key={entry.id}>
              <td><time dateTime={entry.changedAt}>{auditDateTime(entry.changedAt)}</time></td>
              <td>{auditActor(entry)}</td><td>{entry.divisionName ?? '—'}</td>
              <td><Link className="admin-audit-row-link" to={link(entry)} state={{ backQuery }}>
                <span>{auditDescription(entry)}</span><ChevronRight aria-hidden="true" />
              </Link></td>
            </tr>
          ))}</tbody>
        </table>
      </section>
      <ul className="admin-surface admin-audit-mobile" aria-label="Daftar perubahan audit">
        {entries.map((entry) => (
          <li key={entry.id}>
            <Link className="admin-audit-row-link" to={link(entry)} state={{ backQuery }}>
              <span><time dateTime={entry.changedAt}>{auditDateTime(entry.changedAt)}</time>
                <small>{auditActor(entry)}{entry.divisionName && ` · ${entry.divisionName}`}</small>
                <strong>{auditDescription(entry)}</strong></span>
              <ChevronRight aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export function AdminAuditPage() {
  const [params, replaceFilters] = useAdminSearchFilters();
  const [showExtraFilters, setShowExtraFilters] = useState(false);
  const unfiltered = useQuery(adminAuditQuery());
  const divisions = useQuery(adminDivisionsQuery());
  const filters = new URLSearchParams();
  for (const key of ['actor', 'action', 'divisionId', 'entity']) {
    const value = params.get(key);
    if (value) filters.set(key, value);
  }
  const period = params.get('period');
  if (validMonth(period)) {
    const { from, to } = monthRange(period);
    filters.set('from', from);
    filters.set('to', to);
  }
  const entries = useQuery(adminAuditQuery(filters));
  const noResults = filters.size > 0 && entries.data?.length === 0 && divisions.isSuccess && unfiltered.isSuccess;
  const months = recentMonths((unfiltered.data ?? []).map((entry) => auditMonthKey(entry.changedAt)));
  const people = namedOptions((unfiltered.data ?? []).filter((entry) => entry.actorId || entry.actorEmail)
    .map((entry) => ({ value: (entry.actorId ?? entry.actorEmail)!, label: auditActor(entry) })));

  function setFilter(key: string, value: string) {
    replaceFilters((next) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
  }

  return (
    <div className={noResults ? 'admin-page admin-audit-page admin-audit-page-no-results' : 'admin-page admin-audit-page'}>
      <AdminPageHeader title="Audit Log" breadcrumbs={[{ label: 'Ruang Kerja Superadmin', to: '/admin' }, { label: 'Audit Log' }]} />
      <div className="admin-audit-lead"><AdminBanner icon={FileText} title="Audit Log"
        description="Riwayat aktivitas dan perubahan data di Ruang Kerja Superadmin." /></div>
      <section className="admin-surface admin-audit-filters" aria-label="Filter audit">
        <h2>Filter</h2>
        <div className={`admin-filters${showExtraFilters ? ' admin-audit-show-extra' : ''}`}>
          <AdminFilter className="admin-audit-filter-period" label="Periode" icon={Calendar} empty="Pilih periode" value={period ?? ''} onChange={(value) => setFilter('period', value)}
            options={months.map((value) => ({ value, label: monthName(value) }))} />
          <AdminFilter className="admin-audit-extra" id="audit-filter-actor" label="Pengguna" icon={UserRound} empty="Pilih pengguna" value={params.get('actor') ?? ''} onChange={(value) => setFilter('actor', value)}
            options={people} />
          <AdminFilter className="admin-audit-filter-division" label="Divisi" icon={Layers} empty="Pilih divisi" value={params.get('divisionId') ?? ''} onChange={(value) => setFilter('divisionId', value)}
            options={(divisions.data ?? []).map(({ id, name }) => ({ value: id, label: name }))} />
          <AdminFilter className="admin-audit-extra" id="audit-filter-action" label="Jenis tindakan" icon={FileText} empty="Pilih jenis tindakan" value={params.get('action') ?? ''} onChange={(value) => setFilter('action', value)}
            options={actions} />
          {noResults && <button className="admin-audit-more" type="button" aria-expanded={showExtraFilters}
            aria-controls="audit-filter-actor audit-filter-action" onClick={() => setShowExtraFilters((visible) => !visible)}>
            {showExtraFilters ? 'Sembunyikan filter lain' : 'Filter lain'}
          </button>}
        </div>
      </section>
      {entries.isPending || unfiltered.isPending || divisions.isPending ? <p role="status"><span className="loading-inline"><span className="ui-spinner" aria-hidden="true" />Memuat audit log</span></p>
        : entries.isError || unfiltered.isError || divisions.isError ? <LoadProblem title="Audit log belum dapat dimuat." retry={() => {
            void entries.refetch();
            void unfiltered.refetch();
            void divisions.refetch();
          }} />
        : entries.data.length === 0
          ? <section className="admin-surface admin-audit-empty"><AdminEmptyState title={filters.size ? 'Tidak ada hasil' : 'Belum ada perubahan'}
              description={filters.size ? undefined : 'Aktivitas akan muncul setelah ada perubahan data.'}
              image={filters.size ? 'no-results' : 'empty'}
              action={filters.size > 0 && <button className="ui-button admin-clear" type="button" onClick={() => {
                setShowExtraFilters(false);
                replaceFilters(new URLSearchParams());
              }}>Hapus filter</button>} /></section>
          : <AuditEntries entries={entries.data} backQuery={params.toString()} />}
    </div>
  );
}
