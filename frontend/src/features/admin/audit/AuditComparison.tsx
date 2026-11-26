import { ArrowRight } from 'lucide-react';
import { StatusBadge } from '../../../shared/ui';
import { workStatus, type Snapshot } from './audit-data';

const fields = {
  name: 'Nama', title: 'Tugas', description: 'Deskripsi', date: 'Tanggal', email: 'Email',
  code: 'Kode', role: 'Peran', status: 'Status', state: 'Status akun',
  division_id: 'Divisi', project_id: 'Proyek', pic_id: 'PIC',
};
type Field = keyof typeof fields;

const vocabulary: Record<string, string> = {
  member: 'Anggota Divisi', superadmin: 'Superadmin', active: 'Aktif', archived: 'Diarsipkan',
  revoked: 'Akses dicabut', pending: 'Menunggu aktivasi', accepted: 'Aktif', expired: 'Kedaluwarsa',
};

function DiffValue({ field, value }: { field: Field; value: unknown }) {
  if (field === 'status' && workStatus(value)) return <StatusBadge status={value} />;
  if (typeof value === 'string') return <>{value ? vocabulary[value] ?? value : '—'}</>;
  if (typeof value === 'number') return <>{value}</>;
  if (typeof value === 'boolean') return <>{value ? 'Ya' : 'Tidak'}</>;
  return <>—</>;
}

export function AuditComparison({ before, after }: { before: Snapshot; after: Snapshot }) {
  const visible = (Object.keys(fields) as Field[]).filter((field) =>
    (before?.[field] ?? null) !== (after?.[field] ?? null),
  );
  return (
    <div className="audit-comparison-grid">
      {[{ heading: 'Sebelum', snapshot: before }, { heading: 'Sesudah', snapshot: after }].map(({ heading, snapshot }, index) => (
        <div className="audit-diff audit-diff-generic" key={heading}>
          <h3>{heading}</h3>
          {snapshot && visible.length > 0 ? (
            <dl>
              {visible.map((field) => <div key={field}><dt>{fields[field]}</dt><dd><DiffValue field={field} value={snapshot[field]} /></dd></div>)}
            </dl>
          ) : <p>{snapshot ? 'Detail kolom tidak tersedia.' : 'Belum ada data.'}</p>}
          {index === 0 && <ArrowRight className="audit-generic-arrow" aria-hidden="true" />}
        </div>
      ))}
    </div>
  );
}
