import { ChevronDown, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { statusIcons, statusLabels } from '../../../shared/ui';
import type { Status } from '../../../shared/types';

export function AdminTile({ icon: Icon }: { icon: LucideIcon }) {
  return <span className="admin-tile" aria-hidden="true"><Icon strokeWidth={1.7} /></span>;
}

export function AdminBanner({ icon, title, description, aside }: {
  icon: LucideIcon; title: ReactNode; description?: ReactNode; aside?: ReactNode;
}) {
  return (
    <div className="admin-banner">
      <AdminTile icon={icon} />
      <div><strong>{title}</strong>{description && <p>{description}</p>}</div>
      {aside && <span className="admin-banner-aside">{aside}</span>}
    </div>
  );
}

export type FilterOption = { value: string; label: string };

export function AdminFilter({ label, icon, value, options, empty, onChange, className, id }: {
  label: string;
  icon: LucideIcon;
  value: string;
  empty: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  className?: string;
  id?: string;
}) {
  const Icon = icon;
  return (
    <label id={id} className={className ? `admin-filter ${className}` : 'admin-filter'}>
      <span className="admin-filter-label"><AdminTile icon={icon} />{label}</span>
      <span className="admin-filter-control">
        <Icon className="admin-filter-control-icon" aria-hidden="true" strokeWidth={1.6} />
        <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">{empty}</option>
          {options.map(({ value: optionValue, label: optionLabel }) => (
            <option key={optionValue} value={optionValue}>{optionLabel}</option>
          ))}
        </select>
        <ChevronDown className="admin-filter-chevron" aria-hidden="true" />
      </span>
    </label>
  );
}

export const statuses = ['pending', 'on_progress', 'done'] as const;

export function AdminStatusSummary({ counts }: { counts?: Record<Status, number> }) {
  return (
    <div className="admin-status-summary" aria-label="Ringkasan status tugas">
      {statuses.map((status) => {
        const Icon = statusIcons[status];
        return (
          <div className={`admin-stat admin-stat-${status}`} key={status}>
            <Icon aria-hidden="true" strokeWidth={1.55} />
            <div><strong>{counts?.[status] ?? '—'}</strong><span>{statusLabels[status]}</span></div>
          </div>
        );
      })}
    </div>
  );
}
