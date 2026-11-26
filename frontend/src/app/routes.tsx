import { createBrowserRouter, Link } from 'react-router-dom';
import { AccountPage } from '../features/auth/AccountPage';
import { ActivationPage } from '../features/auth/ActivationPage';
import { LoginPage } from '../features/auth/LoginPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { ProjectDetail } from '../features/projects/ProjectDetail';
import { EditProject, NewProject } from '../features/projects/ProjectFormRoutes';
import { ProjectList } from '../features/projects/ProjectList';
import { TimesheetCreate, TimesheetDetail, TimesheetEdit, TimesheetList } from '../features/timesheets';
import { DivisionLayout } from './DivisionLayout';
import { RequireSession } from './RequireSession';

function NotFound({ home = '/' }: { home?: string }) {
  return (
    <section className="load-problem">
      <h1>Halaman tidak ditemukan</h1>
      <Link className="ui-button" to={home}>Kembali ke Dashboard</Link>
    </section>
  );
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/activate', element: <ActivationPage /> },
  {
    element: <RequireSession role="superadmin" />,
    children: [{
      path: 'admin',
      lazy: async () => ({ Component: (await import('../features/admin/shell/AdminLayout')).AdminLayout }),
      children: [
        { index: true, lazy: async () => ({ Component: (await import('../features/admin/reports/AdminDashboardPage')).AdminDashboardPage }) },
        { path: 'timesheets', lazy: async () => ({ Component: (await import('../features/admin/reports/AdminReportsPage')).AdminReportsPage }) },
        { path: 'timesheets/:divisionId', lazy: async () => ({ Component: (await import('../features/admin/reports/AdminDivisionReportPage')).AdminDivisionReportPage }) },
        { path: 'tasks/:id', lazy: async () => ({ Component: (await import('../features/admin/reports/AdminTaskDetailPage')).AdminTaskDetailPage }) },
        { path: 'users', lazy: async () => ({ Component: (await import('../features/admin/users/AdminUsersPage')).AdminUsersPage }) },
        { path: 'users/invite', lazy: async () => ({ Component: (await import('../features/admin/users/AdminInvitePage')).AdminInvitePage }) },
        { path: 'users/:id', lazy: async () => ({ Component: (await import('../features/admin/users/AdminUserDetailPage')).AdminUserDetailPage }) },
        { path: 'divisions', lazy: async () => ({ Component: (await import('../features/admin/divisions/AdminDivisionsPage')).AdminDivisionsPage }) },
        { path: 'divisions/new', lazy: async () => ({ Component: (await import('../features/admin/divisions/AdminDivisionRoutes')).AdminNewDivisionPage }) },
        { path: 'divisions/:id', lazy: async () => ({ Component: (await import('../features/admin/divisions/AdminDivisionRoutes')).AdminDivisionDetailPage }) },
        { path: 'audit', lazy: async () => ({ Component: (await import('../features/admin/audit/AdminAuditPage')).AdminAuditPage }) },
        { path: 'audit/:id', lazy: async () => ({ Component: (await import('../features/admin/audit/AdminAuditDetailPage')).AdminAuditDetailPage }) },
        { path: 'account', element: <AccountPage /> },
        { path: '*', element: <NotFound home="/admin" /> },
      ],
    }],
  },
  {
    element: <RequireSession role="member" />,
    children: [{
      element: <DivisionLayout />, children: [
        { index: true, element: <DashboardPage /> },
        { path: 'timesheet', element: <TimesheetList /> },
        { path: 'timesheet/new', element: <TimesheetCreate /> },
        { path: 'timesheet/:id', element: <TimesheetDetail /> },
        { path: 'timesheet/:id/edit', element: <TimesheetEdit /> },
        { path: 'projects', element: <ProjectList /> },
        { path: 'projects/new', element: <NewProject /> },
        { path: 'projects/:id', element: <ProjectDetail /> },
        { path: 'projects/:id/edit', element: <EditProject /> },
        { path: 'account', element: <AccountPage /> },
        { path: '*', element: <NotFound /> },
      ],
    }],
  },
]);
