import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, ChevronRight, Layers, Plus, Search, Tag, UserRound, type LucideIcon } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminDivisionsQuery } from '../divisions/division-data';
import { AccountBadge, ManagementAlert, ManagementEmpty, ManagementHeading, ManagementTile } from './management-ui';
import { accountStatusNames, adminUsersQuery, roleNames, userDisplayName } from './user-data';
import './admin-users-list.css';

function FilterSelect({ label, empty, icon: Icon, value, onChange, options }: {
  label: string;
  empty: string;
  icon: LucideIcon;
  value: string;
  onChange: (value: string) => void;
  options: { id: string; label: string }[];
}) {
  return (
    <label className="mgmt-user-filter">
      <span className="mgmt-filter-label">{label}</span>
      <span className="mgmt-user-filter-control">
        <Icon className="mgmt-filter-icon" aria-hidden="true" />
        <select data-empty={!value} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">{empty}</option>
          {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        {!value && <span className="mgmt-filter-empty" aria-hidden="true">{label}</span>}
        <ChevronDown className="mgmt-filter-chevron" aria-hidden="true" />
      </span>
    </label>
  );
}

export function AdminUsersPage() {
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const divisionId = params.get('divisionId') ?? '';
  const role = params.get('role') ?? '';
  const status = params.get('status') ?? '';
  const filtered = Boolean(search.trim() || divisionId || role || status);
  const users = useQuery(adminUsersQuery({ search: search.trim(), divisionId, role, status }));
  const divisions = useQuery(adminDivisionsQuery());

  function filter(key: string, value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  }

  return (
    <div className="mgmt-page mgmt-users">
      <Link className="mgmt-users-back" to="/admin" aria-label="Pengguna, kembali ke Dashboard Superadmin"><ArrowLeft aria-hidden="true" />Pengguna</Link>
      <ManagementHeading title="Daftar Pengguna" section="Superadmin" context="Pengguna" />
      <div className="mgmt-user-tools">
        <div className="mgmt-toolbar mgmt-user-filters">
          <label className="mgmt-user-filter mgmt-user-search">
            <span className="mgmt-filter-label">Cari pengguna</span>
            <span className="mgmt-user-filter-control">
              <Search aria-hidden="true" />
              <input type="search" placeholder="Cari pengguna" maxLength={120} value={search} onChange={(event) => filter('search', event.target.value)} />
            </span>
          </label>
          <FilterSelect label="Divisi" empty="Semua Divisi" icon={Layers} value={divisionId} onChange={(value) => filter('divisionId', value)}
            options={(divisions.data ?? []).map(({ id, name }) => ({ id, label: name }))} />
          <FilterSelect label="Peran" empty="Semua Peran" icon={UserRound} value={role} onChange={(value) => filter('role', value)}
            options={Object.entries(roleNames).map(([id, label]) => ({ id, label }))} />
          <FilterSelect label="Status akun" empty="Semua Status" icon={Tag} value={status} onChange={(value) => filter('status', value)}
            options={Object.entries(accountStatusNames).map(([id, label]) => ({ id, label }))} />
        </div>
        <Link className="mgmt-button mgmt-primary mgmt-invite-link" to="/admin/users/invite"><Plus aria-hidden="true" />Undang pengguna</Link>
      </div>
      <section className="mgmt-panel mgmt-users-table" aria-label="Pengguna">
        <div className="mgmt-user-head" aria-hidden="true"><span>Nama</span><span>Divisi</span><span>Peran</span><span>Status akun</span></div>
        {users.isPending && <p role="status"><span className="loading-inline"><span className="ui-spinner" aria-hidden="true" />Memuat pengguna</span></p>}
        {users.isError && <ManagementAlert><p>Daftar pengguna belum berhasil dimuat.</p><button type="button" className="mgmt-button mgmt-outline" onClick={() => void users.refetch()}>Coba lagi</button></ManagementAlert>}
        {users.data?.length === 0 && (
          <ManagementEmpty title={filtered ? 'Tidak ada hasil' : 'Belum ada pengguna'} filtered={filtered} onClear={filtered ? () => setParams({}, { replace: true }) : undefined} />
        )}
        <ul>
          {users.data?.map((user) => (
            <li key={user.id}>
              <Link className="mgmt-user-row" to={`/admin/users/${user.id}`}>
                <span className="mgmt-user-name">
                  <ManagementTile icon={UserRound} />
                  <span><strong>{userDisplayName(user)}</strong><small>{[user.divisionName, roleNames[user.role]].filter(Boolean).join(' | ')}</small></span>
                </span>
                <span className="mgmt-user-divider">{user.divisionName ?? '—'}</span>
                <span className="mgmt-user-role">{roleNames[user.role]}</span>
                <AccountBadge status={user.status} />
                <ChevronRight className="mgmt-user-chevron" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
