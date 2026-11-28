import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Layers, UserRound } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { StatusBadge } from '../../../shared/ui';
import { CeoEmpty, CeoPageHeader, CeoPeriodPicker, CeoQueryProblem, CeoTile, CeoUpdatedAt } from '../shared/CeoElements';
import { CeoTaskList } from '../shared/CeoTaskList';
import { CeoVoiceSourceNote, withVoiceSource } from '../shared/CeoVoiceSourceNote';
import { ceoProjectQuery, validMonth, withPeriod } from '../shared/ceo-data';

export function CeoProjectPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const month = validMonth(params.get('month'));
  const project = useQuery(ceoProjectQuery(id, month));
  const data = project.data;
  const back = data ? withVoiceSource(withPeriod(`/ceo/divisions/${data.divisionId}`, month), params) : '/ceo/divisions';

  return <div className="ceo-page ceo-project-page">
    <CeoPageHeader title="Detail Proyek" back={back} backLabel={data?.divisionName || 'Divisi'} />
    <CeoVoiceSourceNote />
    {project.isPending ? <CeoEmpty><span className="loading-inline"><span className="ui-spinner" aria-hidden="true" />Memuat detail proyek</span></CeoEmpty>
      : project.isError ? <CeoQueryProblem error={project.error} name="Proyek" retry={() => void project.refetch()} />
        : data && <>
          <section className="ceo-banner" aria-label="Informasi proyek">
            <CeoTile icon={Layers} />
            <div className="ceo-banner-copy">
              <div className="ceo-banner-title"><h2>{data.name}</h2><StatusBadge status={data.status} /></div>
              <div className="ceo-banner-meta">
                <span><Layers aria-hidden="true" /><Link className="ceo-inline-link" to={back}>{data.divisionName}</Link></span>
                <span><UserRound aria-hidden="true" />PIC tugas: {data.picNames.length ? data.picNames.join(', ') : 'Belum ada tugas tercatat'}</span>
                <span><CalendarDays aria-hidden="true" />Diperbarui <CeoUpdatedAt value={data.updatedAt} /></span>
              </div>
              {data.description && <p>{data.description}</p>}
            </div>
          </section>
          <CeoPeriodPicker month={month} onChange={(value) => setParams(value ? { month: value } : {})} allTime />
          <section className="ceo-surface ceo-section" aria-labelledby="ceo-project-tasks">
            <div className="ceo-section-title"><h2 id="ceo-project-tasks">Daftar Tugas</h2></div>
            <CeoTaskList tasks={data.tasks} month={month} descriptions />
          </section>
          <p className="ceo-data-note">Status proyek mengikuti catatan proyek. Daftar tugas mengikuti periode yang dipilih.</p>
        </>}
  </div>;
}
