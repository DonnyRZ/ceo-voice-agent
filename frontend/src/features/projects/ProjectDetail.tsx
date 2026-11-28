import { useQuery } from '@tanstack/react-query';
import { ChevronRight, FileText, Pencil } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../../shared/api';
import type { Project, Task } from '../../shared/types';
import { StatusBadge } from '../../shared/ui';
import { ProjectError, ProjectHeading, ProjectIcon } from './ProjectLayout';
import './project-detail.css';

function ProjectTaskTable({ tasks }: { tasks: Task[] }) {
  return (
    <table className="project-task-table" aria-label="Daftar tugas proyek">
      <thead>
        <tr><th scope="col">Tugas</th><th scope="col">Deskripsi</th><th scope="col">Status</th></tr>
      </thead>
      <tbody>
        {tasks.map((task) => (
          <tr key={task.id}>
            <td className="project-task-title"><Link to={`/timesheet/${task.id}`}>{task.title}</Link></td>
            <td className="project-task-description">{task.description || '—'}</td>
            <td className="project-task-status">
              <StatusBadge status={task.status} icon />
              <ChevronRight className="project-task-chevron" size={20} aria-hidden="true" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ProjectDetail() {
  const { id = '' } = useParams();
  const project = useQuery({
    queryKey: ['projects', id],
    queryFn: ({ signal }) => api<Project>(`/api/projects/${encodeURIComponent(id)}`, { signal }),
  });
  const tasks = useQuery({
    queryKey: ['tasks', { projectId: id }],
    queryFn: ({ signal }) => api<Task[]>(`/api/tasks?${new URLSearchParams({ projectId: id })}`, { signal }),
    enabled: Boolean(id),
  });
  const record = project.data;
  const missing = project.error instanceof ApiError && project.error.status === 404;

  return (
    <div className="project-page project-detail-page">
      <ProjectHeading title="Detail Proyek" section="Proyek" context={record?.name ?? 'Detail Proyek'} parentPath="/projects" />
      {project.isPending && <p className="project-message" role="status"><span className="loading-inline"><span className="ui-spinner" aria-hidden="true" />Memuat proyek</span></p>}
      {project.isError && <ProjectError retry={missing ? undefined : () => void project.refetch()}>{missing ? 'Proyek tidak ditemukan.' : 'Detail proyek belum berhasil dimuat.'}</ProjectError>}
      {record && (
        <>
          <div className="project-detail-summary">
            <div className="project-hero">
              <ProjectIcon name={record.name} />
              <h2>{record.name}</h2>
              <p className="project-hero-description">{record.description || '—'}</p>
            </div>
            <div className="project-mobile-description">
              <span className="project-icon"><FileText aria-hidden="true" size={23} strokeWidth={1.65} /></span>
              <div><strong>Deskripsi proyek</strong><p>{record.description || '—'}</p></div>
            </div>
            <Link className="project-button project-button-primary project-edit-link" to={`/projects/${record.id}/edit`}><Pencil size={19} aria-hidden="true" /> Edit proyek</Link>
          </div>
          <section className="project-panel project-task-panel" aria-labelledby="project-tasks-heading">
            <h2 id="project-tasks-heading">Daftar tugas</h2>
            {tasks.isPending && <p className="project-message" role="status"><span className="loading-inline"><span className="ui-spinner" aria-hidden="true" />Memuat tugas</span></p>}
            {tasks.isError && <ProjectError retry={() => void tasks.refetch()}>Tugas proyek belum berhasil dimuat.</ProjectError>}
            {tasks.data?.length === 0 && <p className="project-message">Belum ada tugas untuk proyek ini.</p>}
            {!!tasks.data?.length && <ProjectTaskTable tasks={tasks.data} />}
          </section>
        </>
      )}
    </div>
  );
}
