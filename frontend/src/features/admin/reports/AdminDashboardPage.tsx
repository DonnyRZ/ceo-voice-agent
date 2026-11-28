import { useQuery } from '@tanstack/react-query';
import { Bell, Calendar, ChevronRight, Layers } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LoadProblem } from '../../../shared/ui';
import { currentMonth, monthName } from '../../timesheets/task-dates';
import { auditDescription, auditSubject } from '../audit/audit-data';
import { AdminBanner, AdminStatusSummary, AdminTile } from '../shell/AdminElements';
import { adminLinks } from '../shell/AdminLayout';
import { AdminPageHeader } from '../shell/AdminPageHeader';
import { adminDashboardQuery, validMonth } from './report-data';
import './admin-dashboard.css';

export function AdminDashboardPage() {
  const [month, setMonth] = useState(currentMonth);
  const dashboard = useQuery(adminDashboardQuery(month));
  const recent = dashboard.data?.recentActivity[0];
  const recentTitle = recent && (recent.entity === 'task' ? auditSubject(recent) : auditDescription(recent));

  return (
    <div className="admin-page admin-dashboard">
      <AdminPageHeader title="Dashboard Superadmin" breadcrumbs={[{ label: 'Ruang Kerja', to: '/' }, { label: 'Superadmin' }]} />
      <div className="admin-dashboard-period">
        <AdminBanner icon={Calendar} title={monthName(month)} />
        <input aria-label="Periode dashboard" type="month" value={month}
          onChange={(event) => { if (validMonth(event.target.value)) setMonth(event.target.value); }} />
      </div>
      <AdminStatusSummary counts={dashboard.data?.byStatus} />
      <section className="admin-surface admin-dashboard-recent" aria-labelledby="admin-recent-title">
        <h2 id="admin-recent-title">Pembaruan terbaru</h2>
        {dashboard.isError ? <LoadProblem title="Pembaruan belum dapat dimuat." retry={() => void dashboard.refetch()} />
          : dashboard.isPending ? <p role="status" className="admin-notice"><span className="loading-inline"><span className="ui-spinner" aria-hidden="true" />Memuat pembaruan</span></p>
          : !recent ? <p className="admin-notice">Belum ada pembaruan pada periode ini.</p>
          : <Link className="admin-dashboard-link" to={recent.entity === 'task' && recent.action !== 'DELETE'
            ? `/admin/tasks/${recent.recordId}` : `/admin/audit/${recent.id}`}>
              <span className="admin-recent-desktop"><AdminTile icon={Layers} /></span>
              <span className="admin-recent-mobile"><AdminTile icon={Bell} /></span>
              <span>{recentTitle}{recent.divisionName && ` · ${recent.divisionName}`}</span>
              <ChevronRight aria-hidden="true" />
            </Link>}
      </section>
      <section className="admin-surface admin-dashboard-shortcuts" aria-labelledby="admin-shortcut-title">
        <h2 id="admin-shortcut-title"><span className="admin-shortcut-desktop">Shortcut</span><span className="admin-shortcut-mobile">Akses cepat</span></h2>
        <ul>
          {adminLinks.slice(1).map(({ to, label, icon }) => (
            <li key={to}>
              <Link className="admin-dashboard-link" to={to}>
                <AdminTile icon={icon} /><strong>{label}</strong><ChevronRight aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
