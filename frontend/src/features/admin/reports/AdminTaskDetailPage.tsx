import { useQuery } from '@tanstack/react-query';
import { Calendar, ClipboardCheck, FileText, Flag, Laptop, Layers, UserRound } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
import { LoadProblem, StatusBadge } from '../../../shared/ui';
import { taskDate } from '../../timesheets/task-dates';
import { AdminBanner, AdminTile } from '../shell/AdminElements';
import { AdminPageHeader } from '../shell/AdminPageHeader';
import { AdminTaskTimeline } from './AdminTaskTimeline';
import { adminTaskQuery } from './report-data';
import './admin-task-detail.css';

export function AdminTaskDetailPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const task = useQuery(adminTaskQuery(id));
  const entry = task.data;
  const back = entry ? `/admin/timesheets/${entry.divisionId}${params.size ? `?${params}` : ''}` : '/admin/timesheets';
  const rows = entry && [
    { label: 'Tugas', value: entry.title, icon: ClipboardCheck, mobileOnly: true },
    { label: 'Tanggal', value: taskDate(entry.date), icon: Calendar },
    { label: 'Divisi', value: entry.divisionName, icon: Laptop },
    { label: 'Proyek', value: entry.projectName, icon: Layers },
    { label: 'Deskripsi', value: entry.description || '—', icon: FileText },
    { label: 'PIC', value: entry.picName, icon: UserRound },
    { label: 'Status', value: <StatusBadge status={entry.status} />, icon: Flag, mobileOnly: true },
  ];

  return (
    <div className="admin-page admin-task-page">
      <AdminPageHeader title="Detail Tugas" breadcrumbs={[{ label: 'Timesheet', to: back }, { label: 'Detail Tugas' }]} />
      {task.isPending ? <p role="status">Memuat tugas…</p>
        : task.isError ? <LoadProblem title="Tugas belum dapat dimuat." retry={() => void task.refetch()} />
        : entry && rows && <>
          <section className="admin-surface admin-task-information" aria-label="Informasi tugas">
            <AdminBanner icon={ClipboardCheck} title={entry.title} aside={<StatusBadge status={entry.status} icon />} />
            <dl className="admin-task-fields">
              {rows.map(({ label, value, icon, mobileOnly }) => (
                <div key={label} className={mobileOnly ? 'admin-mobile-field' : undefined}>
                  <AdminTile icon={icon} />
                  <dt>{label}</dt><dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
          <AdminTaskTimeline id={entry.id} />
        </>}
    </div>
  );
}
