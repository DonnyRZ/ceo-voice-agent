import { createBrowserRouter, Link } from 'react-router-dom';
import { AccountPage } from '../features/auth/AccountPage';
import { LoginPage } from '../features/auth/LoginPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { ProjectDetail } from '../features/projects/ProjectDetail';
import { EditProject, NewProject } from '../features/projects/ProjectFormRoutes';
import { ProjectList } from '../features/projects/ProjectList';
import { TimesheetCreate, TimesheetDetail, TimesheetEdit, TimesheetList } from '../features/timesheets';
import { DivisionLayout } from './DivisionLayout';

function NotFound() {
  return (
    <section className="load-problem">
      <h1>Halaman tidak ditemukan</h1>
      <Link className="ui-button" to="/">Kembali ke Dashboard</Link>
    </section>
  );
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <DivisionLayout />,
    children: [
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
  },
]);
