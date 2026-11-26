import { ChevronRight, Laptop, Layers, Server } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Project, Task } from '../../shared/types';
import { StatusBadge } from '../../shared/ui';
import { formatDay } from './period';

const projectIcons = [Laptop, Layers, Server];

export function RecentUpdates({ tasks, projects }: { tasks: Task[]; projects: Project[] }) {
  const orderedTasks = [...tasks].sort((left, right) =>
    right.date.localeCompare(left.date) || right.updatedAt.localeCompare(left.updatedAt),
  );
  const orderedProjects = [...projects].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );

  return (
    <section className="dashboard-recent" aria-labelledby="dashboard-recent-title">
      <h2 id="dashboard-recent-title">Pembaruan terbaru</h2>
      <div className="desktop-recent">
        {orderedTasks.length > 0 ? (
          <table className="dashboard-update-table">
            <colgroup><col /><col /><col /><col /></colgroup>
            <thead><tr>
              <th scope="col">Tanggal</th><th scope="col">Proyek</th>
              <th scope="col">Pembaruan</th><th scope="col">Status</th>
            </tr></thead>
            <tbody>
              {orderedTasks.slice(0, 2).map((task) => (
                <tr key={task.id}>
                  <td>{formatDay(task.date)}</td>
                  <td><Link className="dashboard-project-link" to={`/projects/${task.projectId}`}>{task.projectName}</Link></td>
                  <td><Link to={`/timesheet/${task.id}`}>{task.title}</Link></td>
                  <td><StatusBadge status={task.status} icon /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="dashboard-no-updates">Belum ada pembaruan pada periode ini.</p>}
      </div>
      <div className="mobile-recent">
        {orderedProjects.length > 0 ? (
          <ul className="dashboard-projects">
            {orderedProjects.slice(0, 3).map((project, index) => {
              const Icon = projectIcons[index];
              return (
                <li key={project.id}>
                  <Link to={`/projects/${project.id}`}>
                    <span className="dashboard-project-icon"><Icon aria-hidden="true" /></span>
                    <span>{project.name}</span>
                    <ChevronRight className="project-arrow" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : <p className="dashboard-no-updates">Belum ada proyek di divisi ini.</p>}
      </div>
    </section>
  );
}
