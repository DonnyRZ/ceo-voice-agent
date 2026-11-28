import { useQuery } from '@tanstack/react-query';
import { Layers } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
import { LoadProblem } from '../../../shared/ui';
import { adminDivisionQuery } from '../divisions/division-data';
import { AdminBanner, AdminStatusSummary } from '../shell/AdminElements';
import { AdminEmptyState } from '../shell/AdminEmptyState';
import { AdminPageHeader } from '../shell/AdminPageHeader';
import { DivisionTaskEntries } from './DivisionTaskEntries';
import { adminTasksQuery, countStatuses, reportFilters } from './report-data';
import './admin-reports.css';

export function AdminDivisionReportPage() {
  const { divisionId = '' } = useParams();
  const [params] = useSearchParams();
  const division = useQuery(adminDivisionQuery(divisionId));
  const tasks = useQuery(adminTasksQuery(reportFilters(params, divisionId)));
  const query = params.toString();
  const back = `/admin/timesheets${query ? `?${query}` : ''}`;

  return (
    <div className="admin-page admin-report-page">
      <AdminPageHeader title="Detail Timesheet Divisi" breadcrumbs={[
        { label: 'Ruang Kerja Superadmin', to: '/admin' },
        { label: 'Timesheet', to: back },
        { label: 'Detail Timesheet Divisi' },
      ]} />
      {division.isPending || tasks.isPending ? <p role="status"><span className="loading-inline"><span className="ui-spinner" aria-hidden="true" />Memuat timesheet divisi</span></p>
        : division.isError || tasks.isError
          ? <LoadProblem title="Timesheet divisi belum dapat dimuat." retry={() => {
            void division.refetch();
            void tasks.refetch();
          }} />
          : <>
              <AdminBanner icon={Layers} title={division.data.name} />
              <AdminStatusSummary counts={countStatuses(tasks.data)} />
              {tasks.data.length === 0
                ? <div className="admin-surface"><AdminEmptyState title="Belum ada timesheet" description="Belum ada tugas untuk pilihan ini." /></div>
                : <DivisionTaskEntries tasks={tasks.data} params={params} />}
            </>}
    </div>
  );
}
