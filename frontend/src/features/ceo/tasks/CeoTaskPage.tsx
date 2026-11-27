import { useQuery } from '@tanstack/react-query';
import { CalendarDays, FileText, Layers, UserRound, UsersRound } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { StatusBadge } from '../../../shared/ui';
import { taskDate } from '../../timesheets/task-dates';
import { CeoEmpty, CeoPageHeader, CeoQueryProblem, CeoTile, CeoUpdatedAt } from '../shared/CeoElements';
import { ceoTaskQuery, validMonth, withPeriod } from '../shared/ceo-data';
import { CeoVoiceSourceNote, withVoiceSource } from '../shared/CeoVoiceSourceNote';
import { CeoTaskTimeline } from './CeoTaskTimeline';
import './ceo-task.css';

export function CeoTaskPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const month = validMonth(params.get('month'));
  const task = useQuery(ceoTaskQuery(id));
  const data = task.data;
  const back = data ? withVoiceSource(withPeriod(`/ceo/projects/${data.projectId}`, month), params) : '/ceo/divisions';
  const fields = data && [
    { label: 'Proyek', icon: Layers, value: <Link to={back}>{data.projectName}</Link> },
    { label: 'Divisi', icon: UsersRound, value: <Link to={withVoiceSource(withPeriod(`/ceo/divisions/${data.divisionId}`, month), params)}>{data.divisionName}</Link> },
    { label: 'PIC', icon: UserRound, value: data.picName },
    { label: 'Tanggal tugas', icon: CalendarDays, value: <time dateTime={data.date}>{taskDate(data.date)}</time> },
    { label: 'Terakhir diperbarui', icon: CalendarDays, value: <CeoUpdatedAt value={data.updatedAt} /> },
  ];

  return <div className="ceo-page ceo-task-page">
    <CeoPageHeader title="Detail Tugas" back={back} backLabel={data?.projectName || 'Divisi'} />
    <CeoVoiceSourceNote />
    {task.isPending ? <CeoEmpty>Memuat detail tugas…</CeoEmpty>
      : task.isError ? <CeoQueryProblem error={task.error} name="Tugas" retry={() => void task.refetch()} />
        : data && fields && <div className="ceo-task-grid">
          <section className="ceo-surface ceo-task-information" aria-label="Informasi tugas">
            <header className="ceo-task-title"><h2>{data.title}</h2><StatusBadge status={data.status} icon /></header>
            <dl className="ceo-task-fields">
              {fields.map(({ label, icon, value }) => <div key={label}>
                <CeoTile icon={icon} /><dt>{label}</dt><dd>{value}</dd>
              </div>)}
            </dl>
          </section>
          <CeoTaskTimeline id={data.id} />
          <section className="ceo-surface ceo-task-description" aria-labelledby="ceo-description-heading">
            <CeoTile icon={FileText} /><div><h2 id="ceo-description-heading">Deskripsi</h2><p>{data.description || 'Belum ada deskripsi tercatat.'}</p></div>
          </section>
        </div>}
  </div>;
}
