import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../../shared/api';
import { useSessionUser } from '../../shared/session';
import type { Project } from '../../shared/types';
import { ProjectForm } from './ProjectForm';
import { ProjectError, ProjectHeading } from './ProjectLayout';

export function NewProject() {
  const { divisionName } = useSessionUser();
  return <ProjectForm divisionName={divisionName} />;
}

export function EditProject() {
  const { divisionName } = useSessionUser();
  const { id = '' } = useParams();
  const project = useQuery({
    queryKey: ['projects', id],
    queryFn: ({ signal }) => api<Project>(`/api/projects/${encodeURIComponent(id)}`, { signal }),
  });
  const missing = project.error instanceof ApiError && project.error.status === 404;

  if (project.data) return <ProjectForm key={id} divisionName={divisionName} project={project.data} />;

  return (
    <div className="project-page project-edit-page">
      <ProjectHeading title="Edit Proyek" section="Proyek" context="Edit Proyek" parentPath="/projects" />
      {project.isPending && <p className="project-message" role="status"><span className="loading-inline"><span className="ui-spinner" aria-hidden="true" />Memuat proyek</span></p>}
      {project.isError && <ProjectError retry={missing ? undefined : () => void project.refetch()}>{missing ? 'Proyek tidak ditemukan.' : 'Proyek belum berhasil dimuat.'}</ProjectError>}
    </div>
  );
}
