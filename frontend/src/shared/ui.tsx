import { CircleCheck, Clock3, RefreshCw } from 'lucide-react';
import type { Status } from './types';

export const statusLabels: Record<Status, string> = {
  pending: 'Pending',
  on_progress: 'On Progress',
  done: 'Done',
};

export const statusIcons = {
  pending: Clock3,
  on_progress: RefreshCw,
  done: CircleCheck,
};

export function StatusBadge({ status, icon = false }: { status: Status; icon?: boolean }) {
  const Icon = statusIcons[status];
  return (
    <span className={`status-badge status-badge--${status}`}>
      {icon && <Icon aria-hidden="true" />}
      {statusLabels[status]}
    </span>
  );
}

export function LoadProblem({ title, retry }: { title: string; retry: () => void }) {
  return (
    <section className="load-problem" role="alert">
      <p>{title}</p>
      <button className="ui-button" type="button" onClick={retry}>Coba lagi</button>
    </section>
  );
}
