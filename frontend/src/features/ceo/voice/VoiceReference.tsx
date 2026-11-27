import { ClipboardList } from 'lucide-react';
import { StatusBadge } from '../../../shared/ui';
import type { VoiceFacts } from './voice-protocol';

const countLabels = { pending: 'Pending', on_progress: 'On Progress', done: 'Done', total: 'Total' } as const;
const dateFormat = new Intl.DateTimeFormat('id-ID', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Jakarta' });

function validDate(value?: string) {
  const date = value && new Date(value);
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function DateText({ value }: { value?: string }) {
  const date = validDate(value);
  return date ? <time dateTime={value}>{dateFormat.format(date)}</time> : null;
}

export function VoiceReference({ facts }: { facts: VoiceFacts }) {
  const counts = facts.counts;
  const updatedAt = facts.updatedAt ?? facts.asOf;
  const hasSources = facts.tasks.length > 0 || facts.history.length > 0;

  return (
    <section className="ceo-voice-card ceo-reference" aria-labelledby="voice-reference-title">
      <h2 id="voice-reference-title"><ClipboardList aria-hidden="true" />Rujukan Timesheet</h2>
      {facts.entity && (
        <div className="ceo-reference-subject">
          <strong>{facts.entity.name}</strong>
          {facts.entity.divisionName && <span>{facts.entity.divisionName}</span>}
        </div>
      )}
      {facts.status && <StatusBadge status={facts.status} />}
      {facts.intent === 'pic' && facts.picName !== undefined && <p className="ceo-voice-muted">PIC {facts.picName ?? '—'}</p>}
      {validDate(updatedAt) && <p className="ceo-voice-muted">Pembaruan terakhir <DateText value={updatedAt} /></p>}
      {facts.period && (validDate(facts.period.from) || validDate(facts.period.to)) && (
        <p className="ceo-voice-muted">Periode <DateText value={facts.period.from} />
          {facts.period.from && facts.period.to ? ' – ' : ' '}
          <DateText value={facts.period.to} />
        </p>
      )}
      {counts && (
        <dl className="ceo-reference-counts">
          {Object.entries(countLabels).map(([key, label]) => (
            <div key={key}><dt>{label}</dt><dd>{counts[key as keyof typeof countLabels]}</dd></div>
          ))}
        </dl>
      )}
      {hasSources && (
        <details open>
          <summary>Sumber dan perubahan</summary>
          {facts.tasks.length > 0 && (
            <ul className="ceo-reference-tasks">
              {facts.tasks.map((task) => (
                <li key={task.id}>
                  <strong>{task.title}</strong>
                  <span>{task.projectName} · {task.divisionName}</span>
                  {task.picName && <span>PIC {task.picName}</span>}
                  <span><DateText value={task.date} /> <StatusBadge status={task.status} /></span>
                </li>
              ))}
            </ul>
          )}
          {facts.history.length > 0 && (
            <ol className="ceo-reference-history">
              {facts.history.map((entry) => (
                <li key={entry.id}>
                  <DateText value={entry.changedAt} />{' '}
                  {entry.previousStatus && <><StatusBadge status={entry.previousStatus} /> <span aria-label="menjadi">→</span>{' '}</>}
                  <StatusBadge status={entry.status} />
                </li>
              ))}
            </ol>
          )}
        </details>
      )}
      {facts.evidenceId && <small className="ceo-reference-id">ID rujukan <code>{facts.evidenceId}</code></small>}
    </section>
  );
}
