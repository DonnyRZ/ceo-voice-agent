import { Link } from 'react-router-dom';
import { StatusBadge } from '../../../shared/ui';
import { shortTaskDate } from '../../timesheets/task-dates';
import type { AdminTask } from './report-data';

export function DivisionTaskEntries({ tasks, params }: { tasks: AdminTask[]; params: URLSearchParams }) {
  const query = params.toString();
  const url = ({ id }: AdminTask) => `/admin/tasks/${id}${query ? `?${query}` : ''}`;
  return (
    <>
      <section className="admin-surface admin-desktop-tasks">
        <table className="admin-data-table" aria-label="Tugas pada timesheet divisi">
          <colgroup><col /><col /><col /><col /><col /><col /></colgroup>
          <thead><tr><th scope="col">Tanggal</th><th scope="col">Tugas</th><th scope="col">Deskripsi</th>
            <th scope="col">Proyek</th><th scope="col">PIC</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td><time dateTime={task.date}>{shortTaskDate(task.date)}</time></td>
                <td><Link to={url(task)}><strong>{task.title}</strong></Link></td>
                <td>{task.description || '—'}</td><td>{task.projectName}</td><td>{task.picName}</td>
                <td><StatusBadge status={task.status} icon /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <ul className="admin-mobile-tasks" aria-label="Tugas pada timesheet divisi">
        {tasks.map((task) => (
          <li key={task.id}>
            <Link className="admin-surface" to={url(task)}>
              <dl>
                <div><dt>Tanggal</dt><dd><time dateTime={task.date}>{shortTaskDate(task.date)}</time></dd></div>
                <div><dt>Tugas</dt><dd>{task.title}</dd></div>
                <div><dt>Deskripsi</dt><dd>{task.description || '—'}</dd></div>
                <div><dt>Proyek</dt><dd>{task.projectName}</dd></div>
                <div><dt>PIC</dt><dd>{task.picName}</dd></div>
                <div><dt>Status</dt><dd><StatusBadge status={task.status} /></dd></div>
              </dl>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
