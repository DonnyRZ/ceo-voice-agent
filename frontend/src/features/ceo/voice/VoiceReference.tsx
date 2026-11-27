import { CalendarDays, ChevronRight, ClipboardCheck, FileText, Layers, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { StatusBadge, statusLabels } from '../../../shared/ui';
import type { VoiceFacts } from './voice-protocol';
import { voicePeriodLabel, voiceSourcePath } from './voice-source';

const dateFormat = new Intl.DateTimeFormat('id-ID', {
  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
});
const countLabels = { pending: 'Pending', on_progress: 'On Progress', done: 'Done', total: 'Total' } as const;

function DateText({ value }: { value?: string }) {
  const date = value && new Date(value);
  return date && Number.isFinite(date.getTime()) ? <time dateTime={value}>{dateFormat.format(date)} WIB</time> : null;
}

export function VoiceReference({ facts, last = false }: { facts: VoiceFacts; last?: boolean }) {
  const entity = facts.entity;
  const path = entity && voiceSourcePath(entity.kind, entity.id, facts);
  const picName = facts.picName !== undefined ? facts.picName : (facts.tasks.length === 1 ? facts.tasks[0].picName : undefined);
  const period = voicePeriodLabel(facts.period);
  const filtered = facts.statusFilter?.length ? facts.statusFilter : undefined;
  return (
    <section className="ceo-reference" aria-labelledby="voice-reference-title">
      <h2 id="voice-reference-title">{last ? 'Jawaban terakhir' : 'Menurut timesheet'}</h2>
      {entity && <div className="ceo-reference-subject ceo-reference-field">
        <Layers className="ceo-reference-desktop" aria-hidden="true" />
        <span className="ceo-reference-desktop">{{ project: 'Proyek', task: 'Tugas', division: 'Divisi' }[entity.kind]}</span>
        <div><h3>{entity.name}</h3>{entity.divisionName && <p>{entity.divisionName}</p>}</div>
      </div>}
      {facts.status && <div className="ceo-reference-field ceo-reference-status"><ClipboardCheck className="ceo-reference-desktop" aria-hidden="true" />
        <span className="ceo-reference-desktop">Status</span><StatusBadge status={facts.status} /></div>}
      <div className="ceo-reference-meta">
        {picName !== undefined && <p className="ceo-reference-field"><UserRound aria-hidden="true" />
          <span className="ceo-reference-desktop">PIC</span><span><span className="ceo-reference-mobile">PIC </span>{picName ?? 'Belum ditetapkan'}</span></p>}
        {facts.updatedAt && <p className="ceo-reference-field"><CalendarDays aria-hidden="true" />
          <span className="ceo-reference-desktop">Diperbarui</span><span><DateText value={facts.updatedAt} /></span></p>}
        {facts.asOf && <p><CalendarDays aria-hidden="true" /><span>Status per <DateText value={facts.asOf} /></span></p>}
        {period && <p><CalendarDays aria-hidden="true" /><span>{period}</span></p>}
      </div>
      {filtered && <p className="ceo-reference-filter">Filter status: {filtered.map((status) => statusLabels[status]).join(', ')}</p>}
      {facts.counts && <dl className="ceo-reference-counts">
        {Object.entries(countLabels).filter(([key]) => !filtered || key === 'total' || filtered.includes(key as typeof filtered[number])).map(([key, label]) => <div key={key}>
          <dt>{filtered && key === 'total' ? 'Jumlah sesuai filter' : label}</dt><dd>{facts.counts![key as keyof typeof countLabels]}</dd>
        </div>)}
      </dl>}
      {path && <Link className="ceo-reference-link" to={path}><FileText aria-hidden="true" />Lihat sumber<ChevronRight aria-hidden="true" /></Link>}
      {(facts.tasks.length > 0 || facts.history.length > 0) && <details className="ceo-reference-details">
        <summary>Catatan yang dirujuk</summary>
        <ul>{facts.tasks.map((task) => <li key={task.id}>
          <Link to={voiceSourcePath('task', task.id, facts)}>{task.title}<ChevronRight aria-hidden="true" /></Link>
          <span>{task.projectName} · {task.divisionName}</span><StatusBadge status={task.status} />
        </li>)}</ul>
        {facts.history.map((entry) => <p key={entry.id}><DateText value={entry.changedAt} /> <StatusBadge status={entry.status} /></p>)}
      </details>}
    </section>
  );
}
