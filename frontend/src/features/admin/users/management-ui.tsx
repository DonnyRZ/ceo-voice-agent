import { CircleAlert, CircleCheck, Clock3, FileText, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { Status } from '../../../shared/types';
import { statusIcons, statusLabels } from '../../../shared/ui';
import { AdminEmptyState } from '../shell/AdminEmptyState';
import { AdminPageHeader } from '../shell/AdminPageHeader';
import { accountStatusNames, type AdminUserStatus } from './user-data';
import './management-base.css';
import './management-states.css';

export function ManagementHeading({ title, section, context, back }: {
  title: string;
  section: string;
  context?: string;
  back?: string;
}) {
  const breadcrumbs = [{ label: section, to: back }];
  if (context) breadcrumbs.push({ label: context, to: undefined });
  return <AdminPageHeader title={title} breadcrumbs={breadcrumbs} />;
}

export function ManagementTile({ icon: Icon }: { icon: LucideIcon }) {
  return <span className="mgmt-tile" aria-hidden="true"><Icon strokeWidth={1.65} /></span>;
}

export function AccountBadge({ status }: { status: AdminUserStatus }) {
  const Icon = status === 'active' ? CircleCheck : status === 'pending' || status === 'expired' ? Clock3 : CircleAlert;
  return <span className={`mgmt-badge mgmt-badge-${status}`}><Icon aria-hidden="true" />{accountStatusNames[status]}</span>;
}

export function ManagementAlert({ children }: { children: ReactNode }) {
  return <div className="mgmt-alert" role="alert"><CircleAlert aria-hidden="true" /><div>{children}</div></div>;
}

export function ManagementEmpty({ title, filtered = false, onClear }: {
  title: string;
  filtered?: boolean;
  onClear?: () => void;
}) {
  return <AdminEmptyState title={title} image={filtered ? 'no-results' : 'empty'}
    action={onClear && <button className="mgmt-button mgmt-outline" type="button" onClick={onClear}>Hapus filter</button>} />;
}

export type TaskCounts = Record<Status, number>;

export function ManagementTaskStats({ counts, variant = '' }: { counts?: TaskCounts; variant?: string }) {
  return (
    <div className={`mgmt-stats ${variant}`} aria-label="Ringkasan status tugas">
      {(Object.keys(statusIcons) as Status[]).map((status) => {
        const Icon = statusIcons[status];
        return (
          <div className={`mgmt-stat mgmt-stat-${status}`} key={status}>
            <span className="mgmt-stat-icon"><Icon aria-hidden="true" /></span>
            <div><strong>{counts?.[status] ?? '—'}</strong><span>{statusLabels[status]}</span></div>
          </div>
        );
      })}
    </div>
  );
}

export function ManagementConfirm({ title, description, icon: Icon = FileText, confirm, warning, bottom, busy, onClose, onConfirm }: {
  title: string;
  description: ReactNode;
  icon?: LucideIcon;
  confirm: string;
  warning?: boolean;
  bottom?: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog ref={dialog} className={`mgmt-dialog${warning || bottom ? ' mgmt-dialog-bottom' : ''}`} aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <ManagementTile icon={Icon} />
      <h2 id={titleId}>{title}</h2>
      <p id={descriptionId}>{description}</p>
      <div className="mgmt-actions">
        <button className="mgmt-button mgmt-outline" type="button" disabled={busy} onClick={onClose} autoFocus>Batal</button>
        <button className={`mgmt-button ${warning ? 'mgmt-danger' : 'mgmt-primary'}`} type="button" disabled={busy} onClick={onConfirm}>
          {busy ? 'Memproses…' : confirm}
        </button>
      </div>
    </dialog>
  );
}
