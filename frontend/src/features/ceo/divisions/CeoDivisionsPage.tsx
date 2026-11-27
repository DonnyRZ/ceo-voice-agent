import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Layers, Search } from 'lucide-react';
import { useDeferredValue } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CeoEmpty, CeoPageHeader, CeoPeriodPicker, CeoQueryProblem, CeoTile } from '../shared/CeoElements';
import { ceoDivisionsQuery, validMonth, withPeriod } from '../shared/ceo-data';
import './ceo-divisions.css';

export function CeoDivisionsPage() {
  const [params, setParams] = useSearchParams();
  const month = validMonth(params.get('month'));
  const search = params.get('search') || '';
  const status = ['active', 'archived', 'all'].includes(params.get('status') || '') ? params.get('status')! : 'active';
  const deferredSearch = useDeferredValue(search);
  const divisions = useQuery(ceoDivisionsQuery(deferredSearch, month, status));
  function change(name: string, value: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(name, value); else next.delete(name);
      return next;
    }, { replace: true });
  }

  return <div className="ceo-page ceo-divisions-page">
    <div className="ceo-divisions-search-panel">
      <CeoPageHeader title="Daftar Divisi" />
      <label className="ceo-search"><Search aria-hidden="true" />
        <input type="search" aria-label="Cari divisi" placeholder="Cari divisi" value={search} onChange={(event) => change('search', event.target.value)} />
      </label>
      <label className="ceo-division-filter">Tampilkan
        <select aria-label="Status divisi" value={status} onChange={(event) => change('status', event.target.value)}>
          <option value="active">Divisi aktif</option><option value="archived">Divisi diarsipkan</option><option value="all">Semua divisi</option>
        </select>
      </label>
    </div>
    {month && <CeoPeriodPicker month={month} onChange={(value) => change('month', value)} allTime />}
    {divisions.isPending ? <CeoEmpty>Memuat divisi…</CeoEmpty>
      : divisions.isError ? <CeoQueryProblem error={divisions.error} name="Daftar divisi" retry={() => void divisions.refetch()} />
        : !divisions.data.length ? <CeoEmpty>{search ? 'Tidak ada divisi yang sesuai dengan pencarian.' : 'Belum ada divisi tercatat.'}</CeoEmpty>
          : <ul className="ceo-list ceo-division-list">
            {divisions.data.map((division) => <li key={division.id}>
              <Link className="ceo-record-link" aria-label={division.name} to={withPeriod(`/ceo/divisions/${division.id}`, month)}>
                <CeoTile icon={Layers} /><div className="ceo-record-copy">
                  <strong>{division.name}</strong><p>{division.taskCount} tugas{division.status === 'archived' ? ' · Diarsipkan' : ''}</p>
                </div><ChevronRight aria-hidden="true" />
              </Link>
            </li>)}
          </ul>}
  </div>;
}
