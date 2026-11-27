import { ArrowLeft, CalendarDays, ChevronDown, Clock3, RefreshCw, CircleCheck, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../../shared/api';
import { LoadProblem, statusLabels } from '../../../shared/ui';
import { monthName, taskTime } from '../../timesheets/task-dates';
import type { StatusCounts } from './ceo-types';

const updateDate = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta',
});

export function CeoPageHeader({ title, back, backLabel, children }: {
  title: string; back?: string; backLabel?: string; children?: ReactNode;
}) {
  return <header className="ceo-page-heading">
    {back && <Link className="ceo-back-link" to={back}><ArrowLeft aria-hidden="true" />{backLabel || 'Kembali'}</Link>}
    <div className="ceo-heading-line"><h1 className="page-title">{title}</h1>{children}</div>
  </header>;
}

export function CeoTile({ icon: Icon }: { icon: LucideIcon }) {
  return <span className="ceo-icon-tile"><Icon aria-hidden="true" strokeWidth={1.7} /></span>;
}

export function CeoPeriodPicker({ month, onChange, allTime = false }: {
  month: string; onChange: (month: string) => void; allTime?: boolean;
}) {
  return <div className="ceo-period-control">
    <label className="ceo-period-picker">
      <CalendarDays aria-hidden="true" /><span>{month ? monthName(month) : 'Semua periode'}</span>
      <ChevronDown aria-hidden="true" />
      <input type="month" aria-label="Periode tugas" value={month} min="1900-01" max="9999-12" onChange={(event) => onChange(event.target.value)} />
    </label>
    {allTime && month && <button className="ceo-text-button" type="button" onClick={() => onChange('')}>Semua periode</button>}
  </div>;
}

export function CeoStatusSummary({ counts, heading, children }: {
  counts: StatusCounts; heading?: string; children?: ReactNode;
}) {
  const states = [
    { status: 'pending' as const, icon: Clock3, hint: 'Menunggu tindak lanjut' },
    { status: 'on_progress' as const, icon: RefreshCw, hint: 'Sedang dikerjakan' },
    { status: 'done' as const, icon: CircleCheck, hint: 'Selesai' },
  ];
  return <section className="ceo-status-summary" aria-label={heading || 'Ringkasan status tugas'}>
    {heading && <h2>{heading}</h2>}
    <div className="ceo-status-grid">{states.map(({ status, icon: Icon, hint }) => (
      <div className={`ceo-status-total ceo-status-total--${status}`} key={status}>
        <Icon aria-hidden="true" strokeWidth={1.6} /><strong>{counts[status]}</strong>
        <span className="ceo-status-name">{statusLabels[status]}</span><small>{hint}</small>
      </div>
    ))}</div>{children}
  </section>;
}

export function CeoUpdatedAt({ value }: { value: string | null }) {
  if (!value) return <span>Belum ada pembaruan tercatat</span>;
  return <time dateTime={value}>{updateDate.format(new Date(value))} · {taskTime(value)}</time>;
}

export function CeoEmpty({ children }: { children: ReactNode }) {
  return <p className="ceo-empty" role="status">{children}</p>;
}

export function CeoQueryProblem({ error, retry, name = 'Data' }: {
  error: unknown; retry: () => void; name?: string;
}) {
  if (error instanceof ApiError && [403, 404].includes(error.status)) {
    return <section className="load-problem" role="alert">
      <p>{error.status === 403 ? 'Anda tidak memiliki akses ke data ini.' : `${name} tidak ditemukan atau sudah diarsipkan.`}</p>
      <Link className="ui-button" to="/ceo/divisions">Kembali ke Divisi</Link>
    </section>;
  }
  return <LoadProblem title={`${name} belum dapat dimuat.`} retry={retry} />;
}
