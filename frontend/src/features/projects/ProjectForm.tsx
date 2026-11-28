import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../shared/api';
import type { Project } from '../../shared/types';
import { DivisionBanner, ProjectHeading, ProjectIcon } from './ProjectLayout';
import './project-form.css';

type FormProps = { divisionName: string; project?: Project };
type ProjectDraft = { name: string; description: string; version?: number };

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <p className="project-field-error" id={id} role="alert">{message}</p> : null;
}

export function ProjectForm({ divisionName, project }: FormProps) {
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [draft, setDraft] = useState<ProjectDraft>(() => ({
    name: project?.name ?? '', description: project?.description ?? '', version: project?.version,
  }));
  const [fields, setFields] = useState<Record<string, string>>({});
  const edit = Boolean(project);
  const title = edit ? 'Edit Proyek' : 'Tambah Proyek';
  const cancelPath = project ? `/projects/${project.id}` : '/projects';
  const save = useMutation({
    mutationFn: (input: ProjectDraft) => api<Project>(project ? `/api/projects/${encodeURIComponent(project.id)}` : '/api/projects', {
      method: project ? 'PATCH' : 'POST', body: JSON.stringify(input),
    }),
    onSuccess: (saved) => {
      cache.setQueryData(['projects', saved.id], saved);
      void cache.invalidateQueries({ queryKey: ['projects'], exact: true });
      void cache.invalidateQueries({ queryKey: ['tasks'] });
      navigate(`/projects/${saved.id}`, { replace: true });
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setFields(error.fields ?? {});
        if (error.status === 409 && project) {
          void cache.invalidateQueries({ queryKey: ['projects', project.id] });
        }
      }
    },
  });
  const stale = edit && save.error instanceof ApiError && save.error.status === 409;

  function setField(field: 'name' | 'description', value: string) {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setFields((previous) => ({ ...previous, [field]: '' }));
    if (save.isError && !stale) save.reset();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.isPending || stale) return;
    const name = draft.name.trim();
    if (!name) {
      setFields({ name: 'Isi nama resmi proyek.' });
      return;
    }
    setFields({});
    save.mutate({ ...draft, name, description: draft.description.trim() });
  }

  return (
    <div className={`project-page project-form-page${edit ? ' project-edit-page' : ' project-create-page'}`}>
      <ProjectHeading title={title} section="Proyek" context={title} parentPath="/projects" />
      {project ? (
        <div className="project-hero project-edit-hero">
          <span className="project-icon-desktop"><ProjectIcon name={project.name} forceLayers /></span>
          <span className="project-icon-mobile"><ProjectIcon name={project.name} /></span>
          <h2>{project.name}</h2>
        </div>
      ) : <DivisionBanner name={divisionName} readOnly />}
      <form className="project-form" onSubmit={submit} noValidate>
        <div className="project-form-fields">
          {!edit && (
            <div className="project-form-field project-division-field">
              <label htmlFor="project-division">Divisi</label>
              <input id="project-division" value={divisionName} readOnly />
            </div>
          )}
          <div className="project-form-field">
            <label htmlFor="project-name">
              {edit ? <><span className="project-name-desktop">Nama Proyek</span><span className="project-name-mobile">Nama resmi</span></> : 'Nama resmi'}
            </label>
            <div>
              <input id="project-name" value={draft.name} required maxLength={120}
                aria-invalid={Boolean(fields.name)} aria-describedby={fields.name ? 'project-name-error' : undefined}
                onChange={(event) => setField('name', event.target.value)} />
              <FieldError id="project-name-error" message={fields.name} />
            </div>
          </div>
          <div className="project-form-field">
            <label htmlFor="project-description">Deskripsi</label>
            <div>
              <textarea id="project-description" value={draft.description} rows={edit ? 3 : 4} maxLength={2000}
                aria-invalid={Boolean(fields.description)} aria-describedby={fields.description ? 'project-description-error' : undefined}
                onChange={(event) => setField('description', event.target.value)} />
              <FieldError id="project-description-error" message={fields.description} />
            </div>
          </div>
        </div>
        {save.isError && (
          <div className="project-error" role="alert">
            <span>{stale ? 'Proyek ini sudah diperbarui. Buka versi terbaru untuk melanjutkan.' : save.error.message}</span>
            {stale && <Link className="project-button project-button-outline" to={cancelPath}>Lihat versi terbaru</Link>}
          </div>
        )}
        <div className="project-form-actions">
          <button type="submit" className="project-button project-button-primary" disabled={save.isPending || stale}>
            {save.isPending ? <span className="loading-inline" aria-live="polite"><span className="ui-spinner" aria-hidden="true" />Menyimpan</span> : edit ? 'Simpan perubahan' : 'Simpan proyek'}
          </button>
          <Link className="project-button project-button-outline" to={cancelPath}>Batal</Link>
        </div>
      </form>
    </div>
  );
}
