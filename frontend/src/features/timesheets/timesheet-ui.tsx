import { ArrowLeft, CircleCheck, Clock3, RefreshCw, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Status } from '../../shared/types'

export const statuses: Status[] = ['pending', 'on_progress', 'done']

export const statusDetails: Record<Status, { label: string; icon: LucideIcon }> = {
  pending: { label: 'Pending', icon: Clock3 },
  on_progress: { label: 'On Progress', icon: RefreshCw },
  done: { label: 'Done', icon: CircleCheck },
}

export function StatusBadge({ status, showIcon = false }: { status: Status; showIcon?: boolean }) {
  const { label, icon: Icon } = statusDetails[status]
  return (
    <span className={`ts-status ts-status--${status}`}>
      {showIcon && <Icon size={18} aria-hidden="true" />}
      {label}
    </span>
  )
}

export function IconTile({ icon: Icon, className = '' }: { icon: LucideIcon; className?: string }) {
  return (
    <span className={`ts-icon-tile ${className}`} aria-hidden="true">
      <Icon strokeWidth={1.7} />
    </span>
  )
}

interface HeadingProps {
  title: string
  division?: string
  backTo?: string
  mobileLead?: ReactNode
}

export function TimesheetHeading({ title, division, backTo = '/timesheet', mobileLead }: HeadingProps) {
  return (
    <header className="ts-heading">
      {mobileLead ?? (
        <Link className="ts-mobile-back" to={backTo}>
          <ArrowLeft size={19} aria-hidden="true" /> Timesheet
        </Link>
      )}
      <h1>{title}</h1>
      <p className="ts-breadcrumb">
        {division ? 'Divisi' : <Link to="/timesheet">Timesheet</Link>}
        <span aria-hidden="true">/</span>
        <strong>{division ?? title}</strong>
      </p>
    </header>
  )
}

export function LoadState({ error, retry }: { error?: string; retry?: () => void }) {
  return (
    <div className="ts-card ts-load-state" role={error ? 'alert' : 'status'}>
      <p>{error ?? <span className="loading-inline" aria-live="polite"><span className="ui-spinner" aria-hidden="true" />Memuat data</span>}</p>
      {retry && <button className="ts-button ts-button--secondary" onClick={retry}>Coba lagi</button>}
    </div>
  )
}
