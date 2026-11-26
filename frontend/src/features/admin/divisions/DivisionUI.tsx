import { Archive, CircleCheck, Database, Laptop, Layers } from 'lucide-react';
import { ManagementTile } from '../users/management-ui';
import type { AdminDivision, DivisionStatus } from './division-data';

export function DivisionTile({ division }: { division: Pick<AdminDivision, 'name' | 'code'> }) {
  const code = division.code.toLowerCase();
  const name = division.name.toLowerCase();
  const icon = code === 'it' || name === 'it' ? Laptop : code.startsWith('fin') || name.includes('finance') ? Database : Layers;
  return <ManagementTile icon={icon} />;
}

export function DivisionBadge({ status }: { status: DivisionStatus }) {
  const active = status === 'active';
  const Icon = active ? CircleCheck : Archive;
  return <span className={`mgmt-badge ${active ? 'mgmt-badge-active' : 'mgmt-badge-revoked'}`}><Icon aria-hidden="true" />{active ? 'Aktif' : 'Diarsipkan'}</span>;
}
