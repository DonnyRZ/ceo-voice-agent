import { queryOptions } from '@tanstack/react-query';
import { api } from '../../../shared/api';
import type { Status } from '../../../shared/types';

export type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE';
export type AuditEntity = 'task' | 'project' | 'division' | 'member' | 'access' | 'invitation';
export type Snapshot = Record<string, unknown> | null;

export interface AdminAudit {
  id: string;
  action: AuditAction;
  entity: AuditEntity;
  recordId: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  divisionId: string | null;
  divisionName: string | null;
  changedAt: string;
  before: Snapshot;
  after: Snapshot;
}

export function adminAuditQuery(filters = new URLSearchParams()) {
  const query = filters.toString();
  return queryOptions({
    queryKey: ['admin', 'audit', query],
    queryFn: ({ signal }) => api<AdminAudit[]>(`/api/admin/audit?${query}`, { signal }),
  });
}

export function adminAuditDetailQuery(id: string) {
  return queryOptions({
    queryKey: ['admin', 'audit', 'detail', id],
    queryFn: ({ signal }) => api<AdminAudit>(`/api/admin/audit/${encodeURIComponent(id)}`, { signal }),
  });
}

const subjectNames: Record<AuditEntity, string> = {
  task: 'Tugas', project: 'Proyek', division: 'Divisi', member: 'Anggota',
  access: 'Hak akses', invitation: 'Undangan',
};
const verbs: Record<AuditAction, string> = { INSERT: 'dibuat', UPDATE: 'diubah', DELETE: 'dihapus' };

function textField(snapshot: Snapshot, key: string) {
  const value = snapshot?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

export function auditSubject(event: AdminAudit) {
  return textField(event.after ?? event.before, 'title')
    ?? textField(event.after ?? event.before, 'name')
    ?? textField(event.after ?? event.before, 'email')
    ?? subjectNames[event.entity];
}

export function auditDescription(event: AdminAudit) {
  if (event.entity === 'task' && event.action === 'UPDATE'
    && event.before?.status !== event.after?.status) return 'Status tugas diubah';
  if (event.entity === 'division' && event.action === 'UPDATE' && event.after?.status === 'archived'
    && event.before?.status !== 'archived') return 'Divisi diarsipkan';
  if (event.entity === 'access' && event.action === 'UPDATE' && event.after?.state === 'revoked'
    && event.before?.state !== 'revoked') return 'Akses dicabut';
  return `${subjectNames[event.entity]} ${verbs[event.action]}`;
}

export function auditActor(event: AdminAudit) {
  return event.actorName ?? event.actorEmail ?? 'Sistem';
}

const jakartaDay = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric',
});
const jakartaMonthKey = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit',
});
const jakartaTime = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export const displayAuditDay = (timestamp: string) => jakartaDay.format(new Date(timestamp));
export const auditMonthKey = (timestamp: string) => jakartaMonthKey.format(new Date(timestamp));
export const auditDateTime = (timestamp: string) =>
  `${displayAuditDay(timestamp)} · ${jakartaTime.format(new Date(timestamp))} WIB`;

export function workStatus(value: unknown): value is Status {
  return value === 'pending' || value === 'on_progress' || value === 'done';
}
