import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Layers, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../../../shared/api';
import { ManagementAlert, ManagementConfirm, ManagementHeading, ManagementTaskStats, ManagementTile } from '../users/management-ui';
import { useManagementTaskCounts } from '../users/management-stats';
import { adminDivisionQuery, type AdminDivision } from './division-data';
import { DivisionForm } from './DivisionForm';
import { DivisionMembers } from './DivisionMembers';
import { DivisionBadge, DivisionTile } from './DivisionUI';
import './admin-division-forms.css';

export function AdminNewDivisionPage() {
  const counts = useManagementTaskCounts();
  return (
    <div className="mgmt-page mgmt-division-create">
      <ManagementHeading title="Tambah Divisi" section="Divisi" context="Tambah Divisi" back="/admin/divisions" />
      <div className="mgmt-band mgmt-division-create-banner">
        <ManagementTile icon={Layers} /><div><h2>Divisi</h2><p>Menambah divisi baru untuk mengelompokkan tim atau unit kerja.</p></div>
      </div>
      <ManagementTaskStats counts={counts} variant="mgmt-division-create-stats" />
      <DivisionForm />
    </div>
  );
}

function DivisionDetailBody({ division }: { division: AdminDivision }) {
  const cache = useQueryClient();
  const counts = useManagementTaskCounts({ divisionId: division.id });
  const [confirm, setConfirm] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const archive = useMutation({
    mutationFn: () => api<AdminDivision>(`/api/admin/divisions/${encodeURIComponent(division.id)}`, {
      method: 'DELETE', body: JSON.stringify({ version: division.version }),
    }),
    onSuccess: (updated) => {
      cache.setQueryData<AdminDivision>(['admin', 'divisions', 'detail', updated.id], (previous) => ({ ...previous, ...updated }));
      void cache.invalidateQueries({ queryKey: ['admin'] });
      setConfirm(false);
      setBlocked(false);
    },
    onError: (error) => {
      setConfirm(false);
      if (error instanceof ApiError && error.status === 409 && error.message.includes('anggota aktif')) setBlocked(true);
      void cache.invalidateQueries({ queryKey: ['admin', 'divisions', 'detail', division.id] });
    },
  });
  const hasBlockers = blocked && (division.memberCount > 0 || Boolean(division.members?.length));

  return (
    <>
      <div className={`mgmt-division-summary${hasBlockers ? ' mgmt-division-summary-blocked' : ''}`}>
        <div className="mgmt-band mgmt-division-identity">
          <DivisionTile division={division} />
          <div><h2>{division.name}</h2><DivisionBadge status={division.status} /></div>
        </div>
        <ManagementTaskStats counts={counts} />
      </div>
      {archive.isError && (!blocked || hasBlockers) && (
        <ManagementAlert>
          <strong>{archive.error.message}</strong>
          {hasBlockers && <p>Pindahkan anggota aktif sebelum mengarsipkan divisi.</p>}
        </ManagementAlert>
      )}
      {archive.isSuccess && <p className="mgmt-division-saved" role="status">Divisi berhasil diarsipkan.</p>}
      <div className={hasBlockers ? 'mgmt-division-blocked' : 'mgmt-division-detail-grid'}>
        {!hasBlockers && <DivisionForm division={division} onArchive={() => { archive.reset(); setConfirm(true); }} />}
        <DivisionMembers division={division} blocked={hasBlockers} />
        {hasBlockers && <button className="mgmt-button mgmt-outline mgmt-archive-disabled" type="button" disabled><Archive aria-hidden="true" />Arsipkan divisi</button>}
      </div>
      {division.status === 'active' && !hasBlockers && (
        <Link className="mgmt-button mgmt-outline mgmt-division-invite" to={`/admin/users/invite?divisionId=${encodeURIComponent(division.id)}`}>
          <UserPlus aria-hidden="true" />Undang anggota
        </Link>
      )}
      {confirm && <ManagementConfirm title={`Arsipkan divisi ${division.name}?`} description="Timesheet dan riwayat tetap tersedia."
        icon={Archive} confirm="Arsipkan divisi" bottom busy={archive.isPending} onClose={() => setConfirm(false)} onConfirm={() => archive.mutate()} />}
    </>
  );
}

export function AdminDivisionDetailPage() {
  const { id = '' } = useParams();
  const division = useQuery(adminDivisionQuery(id));
  const missing = division.error instanceof ApiError && division.error.status === 404;
  return (
    <div className="mgmt-page mgmt-division-detail">
      <ManagementHeading title="Detail dan Edit Divisi" section="Divisi" context={division.data?.name ?? 'Detail Divisi'} back="/admin/divisions" />
      {division.isPending && <p role="status">Memuat divisi…</p>}
      {division.isError && <ManagementAlert><p>{missing ? 'Divisi tidak ditemukan.' : 'Detail divisi belum berhasil dimuat.'}</p>
        {!missing && <button className="mgmt-button mgmt-outline" type="button" onClick={() => void division.refetch()}>Coba lagi</button>}</ManagementAlert>}
      {division.data && <DivisionDetailBody key={division.data.id} division={division.data} />}
    </div>
  );
}
