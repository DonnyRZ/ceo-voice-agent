import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Plus, Search } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { ManagementAlert, ManagementEmpty, ManagementHeading, ManagementTaskStats } from '../users/management-ui';
import { useManagementTaskCounts } from '../users/management-stats';
import { adminDivisionsQuery, type DivisionStatus } from './division-data';
import { DivisionBadge, DivisionTile } from './DivisionUI';
import './admin-divisions-list.css';

const statusFilters = { all: 'Semua', active: 'Aktif', archived: 'Diarsipkan' } as const;

export function AdminDivisionsPage() {
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const statusParam = params.get('status');
  const status = statusParam === 'active' || statusParam === 'archived' ? statusParam : '';
  const filtered = Boolean(search.trim() || status);
  const divisions = useQuery(adminDivisionsQuery({ search: search.trim(), status }));
  const counts = useManagementTaskCounts();

  function applyFilter(key: 'search' | 'status', value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  }

  return (
    <div className="mgmt-page mgmt-divisions-page">
      <ManagementHeading title="Daftar Divisi" section="Ruang Kerja Superadmin" context="Divisi" />
      <ManagementTaskStats counts={counts} variant="mgmt-division-list-stats" />
      <div className="mgmt-division-tools">
        <label className="mgmt-division-search">
          <Search aria-hidden="true" />
          <input type="search" aria-label="Cari divisi" placeholder="Cari divisi" maxLength={120} value={search} onChange={(event) => applyFilter('search', event.target.value)} />
        </label>
        <div className="mgmt-division-status-filters" role="group" aria-label="Filter status">
          <span>Filter status<span className="mgmt-filter-colon">:</span></span>
          <div>
            {(Object.entries(statusFilters) as [DivisionStatus | 'all', string][]).map(([key, label]) => {
              const value = key === 'all' ? '' : key;
              return <button key={key} type="button" aria-pressed={value === status} onClick={() => applyFilter('status', value)}>{label}</button>;
            })}
          </div>
        </div>
        <Link className="mgmt-button mgmt-primary mgmt-add-division" to="/admin/divisions/new"><Plus aria-hidden="true" />Tambah divisi</Link>
      </div>
      <section className="mgmt-panel mgmt-divisions-table" aria-label="Divisi">
        <div className="mgmt-division-head" aria-hidden="true"><span>Divisi</span><span>Status</span></div>
        {divisions.isPending && <p role="status">Memuat divisi…</p>}
        {divisions.isError && <ManagementAlert><p>Daftar divisi belum berhasil dimuat.</p><button type="button" className="mgmt-button mgmt-outline" onClick={() => void divisions.refetch()}>Coba lagi</button></ManagementAlert>}
        {divisions.data?.length === 0 && (
          <ManagementEmpty title={filtered ? 'Tidak ada hasil' : 'Belum ada divisi'} filtered={filtered}
            onClear={filtered ? () => setParams({}, { replace: true }) : undefined} />
        )}
        <ul>
          {divisions.data?.map((division) => (
            <li key={division.id}>
              <Link className="mgmt-division-row" to={`/admin/divisions/${division.id}`}>
                <DivisionTile division={division} />
                <strong>{division.name}</strong>
                <DivisionBadge status={division.status} />
                <ChevronRight className="mgmt-division-chevron" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
