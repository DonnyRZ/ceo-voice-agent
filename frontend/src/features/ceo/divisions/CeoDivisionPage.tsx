import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Layers } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CeoEmpty, CeoPageHeader, CeoPeriodPicker, CeoQueryProblem, CeoStatusSummary, CeoTile } from '../shared/CeoElements';
import { CeoTaskList } from '../shared/CeoTaskList';
import { CeoVoiceSourceNote, withVoiceSource } from '../shared/CeoVoiceSourceNote';
import { ceoDivisionQuery, validMonth, withPeriod } from '../shared/ceo-data';
import './ceo-divisions.css';

export function CeoDivisionPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const month = validMonth(params.get('month'));
  const division = useQuery(ceoDivisionQuery(id, month));
  const data = division.data;

  return <div className="ceo-page ceo-division-detail">
    <CeoPageHeader title="Detail Divisi" back={withPeriod('/ceo/divisions', month)} backLabel="Divisi" />
    <CeoVoiceSourceNote />
    {division.isPending ? <CeoEmpty><span className="loading-inline"><span className="ui-spinner" aria-hidden="true" />Memuat detail divisi</span></CeoEmpty>
      : division.isError ? <CeoQueryProblem error={division.error} name="Divisi" retry={() => void division.refetch()} />
        : data && <>
          <section className="ceo-banner" aria-label={`Divisi ${data.name}`}>
            <CeoTile icon={Layers} /><div className="ceo-banner-copy">
              <h2>{data.name}</h2>{data.description && <p>{data.description}</p>}
              {data.status === 'archived' && <p>Divisi diarsipkan. Riwayat tetap tersedia.</p>}
            </div>
          </section>
          <CeoPeriodPicker month={month} onChange={(value) => setParams(value ? { month: value } : {})} allTime />
          <CeoStatusSummary counts={data.byStatus} />
          <section className="ceo-surface ceo-section" aria-labelledby="ceo-division-projects">
            <div className="ceo-section-title"><h2 id="ceo-division-projects">Proyek</h2></div>
            {!data.projects.length ? <CeoEmpty>Belum ada proyek pada divisi ini.</CeoEmpty> : <ul className="ceo-list">
              {data.projects.map((project) => <li key={project.id}>
                <Link className="ceo-record-link" aria-label={project.name} to={withVoiceSource(withPeriod(`/ceo/projects/${project.id}`, month), params)}>
                  <CeoTile icon={Layers} /><div className="ceo-record-copy"><strong>{project.name}</strong><p>{project.taskCount} tugas</p></div>
                  <ChevronRight aria-hidden="true" />
                </Link>
              </li>)}
            </ul>}
          </section>
          <section className="ceo-surface ceo-section" aria-labelledby="ceo-division-tasks">
            <div className="ceo-section-title"><h2 id="ceo-division-tasks">Timesheet Divisi</h2></div>
            <CeoTaskList tasks={data.tasks} month={month} />
          </section>
        </>}
  </div>;
}
