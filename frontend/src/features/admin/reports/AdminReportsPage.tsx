import { useQuery } from '@tanstack/react-query';
import { BriefcaseBusiness, CalendarDays, ChevronRight, Database, Laptop, Layers } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LoadProblem, StatusBadge } from '../../../shared/ui';
import { adminDivisionsQuery } from '../divisions/division-data';
import { AdminBanner, AdminStatusSummary, AdminTile } from '../shell/AdminElements';
import { AdminEmptyState } from '../shell/AdminEmptyState';
import { AdminPageHeader } from '../shell/AdminPageHeader';
import { useAdminSearchFilters } from '../shell/useAdminSearchFilters';
import { adminTasksQuery, countStatuses, reportFilters, type AdminTask } from './report-data';
import { ReportFilters } from './ReportFilters';
import './admin-reports.css';

function divisionIcon(name: string) {
  if (name === 'IT') return Laptop;
  if (name === 'Finance') return Database;
  if (name === 'Operasional') return BriefcaseBusiness;
  return Layers;
}

function ReportDivisions({ tasks, query }: { tasks: AdminTask[]; query: string }) {
  const divisions = new Map<string, { name: string; tasks: AdminTask[] }>();
  for (const task of tasks) {
    const division = divisions.get(task.divisionId);
    if (division) division.tasks.push(task);
    else divisions.set(task.divisionId, { name: task.divisionName, tasks: [task] });
  }

  return (
    <>
      <div className="admin-report-header" aria-hidden="true"><strong>Divisi</strong><strong>Jumlah Tugas</strong></div>
      <ul className="admin-report-divisions">
        {[...divisions].map(([id, { name, tasks: divisionTasks }]) => {
          const counts = countStatuses(divisionTasks)!;
          const status = counts.pending ? 'pending' : counts.on_progress ? 'on_progress' : 'done';
          return (
            <li key={id}>
              <Link className="admin-report-division" to={`/admin/timesheets/${id}${query ? `?${query}` : ''}`}>
                <span className="admin-report-name"><AdminTile icon={divisionIcon(name)} /><strong>{name}</strong></span>
                <span className="admin-report-quantity">{divisionTasks.length} tugas <StatusBadge status={status} /></span>
                <ChevronRight aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function AdminReportsPage() {
  const [params, replaceFilters] = useAdminSearchFilters();
  const divisions = useQuery(adminDivisionsQuery());
  const unfiltered = useQuery(adminTasksQuery());
  const filters = reportFilters(params);
  const tasks = useQuery(adminTasksQuery(filters));
  const filtered = filters.size > 0;
  const empty = !filtered && tasks.data?.length === 0 && unfiltered.isSuccess && divisions.isSuccess;

  function setFilter(name: string, value: string) {
    replaceFilters((next) => {
      if (value) next.set(name, value);
      else next.delete(name);
      if (name === 'divisionId') {
        next.delete('projectId');
        next.delete('picId');
      }
    });
  }

  return (
    <div className={empty ? 'admin-page admin-report-page admin-report-empty-page' : 'admin-page admin-report-page'}>
      <AdminPageHeader title="Timesheet Semua Divisi" mobileContext={empty ? undefined : 'Superadmin'}
        breadcrumbs={[{ label: 'Ruang Kerja Superadmin', to: '/admin' }, { label: 'Timesheet' }]} />
      <ReportFilters divisions={divisions.data ?? []} tasks={unfiltered.data ?? []} params={params} set={setFilter} />
      {empty && <div className="admin-report-empty-banner"><AdminBanner icon={CalendarDays} title="Semua Divisi" /></div>}
      <AdminStatusSummary counts={countStatuses(tasks.data)} />
      <section className="admin-surface admin-report-content" aria-label="Timesheet per divisi">
        {tasks.isPending || divisions.isPending || unfiltered.isPending ? <p role="status">Memuat timesheet…</p>
          : tasks.isError || divisions.isError || unfiltered.isError
            ? <LoadProblem title="Timesheet belum dapat dimuat." retry={() => {
              void tasks.refetch();
              void divisions.refetch();
              void unfiltered.refetch();
            }} />
            : tasks.data.length === 0
              ? <AdminEmptyState title={filtered ? 'Tidak ada hasil' : 'Belum ada timesheet'}
                  description={filtered ? 'Coba sesuaikan filter untuk menemukan timesheet.' : 'Timesheet muncul setelah divisi mencatat tugas.'}
                  image={filtered ? 'no-results' : 'empty'}
                  action={filtered && <button className="ui-button admin-clear" type="button" onClick={() => replaceFilters(new URLSearchParams())}>Hapus filter</button>} />
              : <ReportDivisions tasks={tasks.data} query={params.toString()} />}
      </section>
    </div>
  );
}
