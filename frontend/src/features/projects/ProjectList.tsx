import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Plus, Search, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api';
import { useSessionUser } from '../../shared/session';
import type { Project } from '../../shared/types';
import { DivisionBanner, ProjectError, ProjectHeading, ProjectIcon } from './ProjectLayout';
import './project-list.css';

export function ProjectList() {
  const user = useSessionUser();
  const [search, setSearch] = useState('');
  const projects = useQuery({ queryKey: ['projects'], queryFn: ({ signal }) => api<Project[]>('/api/projects', { signal }) });
  const filter = search.trim().normalize('NFC').toLocaleLowerCase('id-ID');
  const visibleProjects = projects.data?.filter(({ name }) =>
    name.normalize('NFC').toLocaleLowerCase('id-ID').includes(filter),
  );

  return (
    <div className="project-page project-list-page">
      <div className="project-user-badge"><UserRound size={20} aria-hidden="true" /> Anggota Divisi {user.divisionName}</div>
      <ProjectHeading title="Daftar Proyek Divisi" section="Divisi" context={user.divisionName} />
      <DivisionBanner name={user.divisionName} />
      <div className="project-toolbar">
        <label className="project-search" htmlFor="project-search">
          <span className="project-search-label">Cari proyek</span>
          <span className="project-search-field">
            <Search size={21} aria-hidden="true" />
            <input id="project-search" type="search" placeholder="Cari proyek" value={search} onChange={(event) => setSearch(event.target.value)} />
            {!search && <span className="project-search-hint" aria-hidden="true">Masukkan nama proyek</span>}
          </span>
        </label>
        <Link className="project-button project-button-primary project-create-link" to="/projects/new"><Plus aria-hidden="true" /> Tambah proyek</Link>
      </div>
      <section className="project-panel project-list" aria-label="Proyek divisi">
        <div className="project-list-title" aria-hidden="true">Proyek</div>
        {projects.isPending && <p className="project-message" role="status"><span className="loading-inline"><span className="ui-spinner" aria-hidden="true" />Memuat proyek</span></p>}
        {projects.isError && <ProjectError retry={() => void projects.refetch()}>Daftar proyek belum berhasil dimuat.</ProjectError>}
        {projects.isSuccess && visibleProjects?.length === 0 && (
          <p className="project-message" role="status">{filter ? 'Proyek tidak ditemukan' : 'Belum ada proyek di divisi ini.'}</p>
        )}
        {projects.isSuccess && visibleProjects && (
          <ul>
            {visibleProjects.map((project) => (
              <li key={project.id}>
                <Link to={`/projects/${project.id}`} className="project-list-row">
                  <ProjectIcon name={project.name} />
                  <strong>{project.name}</strong>
                  <ChevronRight size={24} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
