import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Calendar, CalendarDays, ChevronDown, ChevronRight, Laptop } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api';
import { useSessionUser } from '../../shared/session';
import type { Project, Status, Task } from '../../shared/types';
import { LoadProblem, statusIcons, statusLabels } from '../../shared/ui';
import { currentMonth, monthFilters, monthTitle } from './period';
import { RecentUpdates } from './RecentUpdates';
import './dashboard.css';
import './dashboard-mobile.css';

const statuses: Status[] = ['pending', 'on_progress', 'done'];

export function DashboardPage() {
  const user = useSessionUser();
  const [month, setMonth] = useState(currentMonth);
  const byMonth = monthFilters(month);
  const tasks = useQuery({
    queryKey: ['tasks', 'dashboard', user.divisionId, month],
    queryFn: ({ signal }) => api<Task[]>(`/api/tasks?${byMonth}`, { signal }),
  });
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: ({ signal }) => api<Project[]>('/api/projects', { signal }),
  });
  const loadedTasks = tasks.data ?? [];
  const label = monthTitle(month);

  return (
    <div className="dashboard">
      <header className="dashboard-heading">
        <h1 className="page-title">Dashboard Divisi</h1>
        <div className="dashboard-meta">
          <span className="dashboard-breadcrumb"><span>Divisi</span><span aria-hidden="true">/</span><strong>{user.divisionName}</strong></span>
          <span className="dashboard-mobile-division">{user.divisionName}, </span>
          <label className="dashboard-period">
            <Calendar className="period-icon" aria-hidden="true" />
            <span aria-hidden="true">{label}</span>
            <ChevronDown className="period-chevron" aria-hidden="true" />
            <input type="month" aria-label="Periode dashboard" value={month}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (/^\d{4}-\d{2}$/.test(value)) setMonth(value);
              }} />
          </label>
        </div>
      </header>

      <div className="dashboard-team">
        <span className="dashboard-team-icon"><Laptop aria-hidden="true" /></span>
        <div><strong>{user.divisionName}</strong><small>Anggota Divisi</small></div>
      </div>

      <div className="dashboard-stats" aria-label="Status tugas">
        {statuses.map((status) => {
          const Icon = statusIcons[status];
          const count = loadedTasks.filter((task) => task.status === status).length;
          return (
            <div className={`dashboard-stat dashboard-stat--${status}`} key={status}>
              <Icon className="dashboard-stat-icon" aria-hidden="true" strokeWidth={1.55} />
              <div>
                <strong>{tasks.isPending ? <span className="loading-inline" role="status" aria-label="Memuat ringkasan"><span className="ui-spinner" aria-hidden="true" /></span> : tasks.isError ? '—' : count}</strong>
                <span>{statusLabels[status]}</span>
              </div>
            </div>
          );
        })}
      </div>

      <Link to="/timesheet" className="dashboard-open" aria-label="Buka Timesheet">
        <span className="dashboard-open-icon">
          <Calendar className="dashboard-desktop-calendar" aria-hidden="true" />
          <CalendarDays className="dashboard-mobile-calendar" aria-hidden="true" />
        </span>
        <strong>Timesheet Divisi</strong>
        <span className="dashboard-open-action">
          Buka Timesheet
          <ArrowRight className="dashboard-arrow" aria-hidden="true" />
          <ChevronRight className="dashboard-chevron" aria-hidden="true" />
        </span>
      </Link>

      {(tasks.isError || projects.isError) ? (
        <LoadProblem title="Pembaruan tidak dapat dimuat." retry={() => {
          void tasks.refetch();
          void projects.refetch();
        }} />
      ) : tasks.isPending || projects.isPending ? (
        <p role="status" className="dashboard-no-updates"><span className="loading-inline"><span className="ui-spinner" aria-hidden="true" />Memuat pembaruan</span></p>
      ) : (
        <RecentUpdates tasks={loadedTasks} projects={projects.data} />
      )}
    </div>
  );
}
