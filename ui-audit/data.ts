export const updatedAt = '2026-11-28T02:15:00.000Z';
export const byStatus = { pending: 1, on_progress: 1, done: 1 };
export const member = { id: 'member-1', name: 'Doni Pratama', email: 'doni@example.test', role: 'member', divisionId: 'division-1', divisionName: 'Teknologi Informasi' };
export const division = { id: 'division-1', name: 'Teknologi Informasi', code: 'IT', description: 'Pengembangan aplikasi dan operasional teknologi perusahaan.', status: 'active', memberCount: 2, projectCount: 1, taskCount: 3, byStatus, progress: 33, version: 1, updatedAt, members: [member] };
export const project = { id: 'project-1', name: 'Aplikasi Operasional Tambang', description: 'Integrasi pelaporan lapangan, persetujuan pekerjaan, dan pemantauan progres.', status: 'on_progress', version: 1, updatedAt, divisionId: division.id, divisionName: division.name, byStatus, taskCount: 3, progress: 33, picNames: [member.name] };
export const task = { id: 'task-1', title: 'Validasi akses dan sinkronisasi laporan lapangan', description: 'Periksa hak akses setiap peran, tampilkan pesan kegagalan yang jelas, dan pastikan perubahan tersimpan.', date: '2026-11-28', projectId: project.id, projectName: project.name, picId: member.id, picName: member.name, status: 'on_progress', version: 1, updatedAt, divisionId: division.id, divisionName: division.name };
export const tasks = [task, { ...task, id: 'task-2', title: 'Persiapan laporan harian', status: 'pending' }, { ...task, id: 'task-3', title: 'Uji notifikasi pekerjaan selesai', status: 'done' }];
export const user = { ...member, status: 'active', kind: 'account', version: 1, updatedAt };
export const history = [{ id: 'history-1', changedAt: updatedAt, previousStatus: 'pending', status: 'on_progress', actorName: member.name }];
export const audit = { id: 'audit-1', action: 'UPDATE', entity: 'task', recordId: task.id, actorId: member.id, actorName: member.name, actorEmail: member.email, divisionId: division.id, divisionName: division.name, changedAt: updatedAt, before: { ...task, status: 'pending' }, after: task };

export type Role = 'public' | 'member' | 'superadmin' | 'ceo';
export type State = 'ready' | 'loading' | 'error' | 'empty' | 'missing';
export function identity(role: Role) {
  return role === 'public' ? null : role === 'member' ? member
    : { ...member, id: `${role}-1`, name: role === 'ceo' ? 'Dimas Santoso' : 'Administrator', role, divisionId: null, divisionName: null };
}

export function responseFor(path: string, state: State) {
  if (path === '/api/registration/status') return { registration: state === 'empty' ? null : {
    name: 'Anggota QA', email: 'anggota@egiresources.com', division_id: 'division-1', verified: true, delivery: 'sent',
  } };
  if (path === '/api/registration/divisions') return {
    divisions: state === 'empty' ? [] : [{ id: 'division-1', name: 'IT' }, { id: 'division-2', name: 'Finance' }],
    emailDomains: ['egiresources.com'],
  };
  const empty = state === 'empty';
  const list = empty ? [] : tasks;
  if (path.endsWith('/history')) return empty ? [] : history;
  if (path === '/api/divisions/current') return division;
  if (path === '/api/divisions/current/members' || path === '/api/members') return [member];
  if (path === '/api/projects') return empty ? [] : [project];
  if (path.startsWith('/api/projects/')) return project;
  if (path === '/api/tasks') return list;
  if (path.startsWith('/api/tasks/')) return task;
  if (path === '/api/admin/dashboard') return { counts: { divisions: 1, users: 2, tasks: list.length, audit: 1 }, byStatus: empty ? { pending: 0, on_progress: 0, done: 0 } : byStatus, recentActivity: empty ? [] : [audit] };
  if (path === '/api/admin/divisions') return empty ? [] : [division];
  if (path.startsWith('/api/admin/divisions/')) return { ...division, members: empty ? [] : [member], memberCount: empty ? 0 : 1 };
  if (path === '/api/admin/users') return empty ? [] : [user, { ...user, id: 'invitation-1', kind: 'invitation', status: 'pending', name: null }];
  if (path.startsWith('/api/admin/users/')) return user;
  if (path === '/api/admin/tasks') return list;
  if (path.startsWith('/api/admin/tasks/')) return task;
  if (path === '/api/admin/audit') return empty ? [] : [audit];
  if (path.startsWith('/api/admin/audit/')) return audit;
  if (path === '/api/ceo/dashboard') return { counts: { divisions: 1, projects: 1, tasks: list.length, members: 2 }, byStatus: empty ? { pending: 0, on_progress: 0, done: 0 } : byStatus, divisions: empty ? [] : [division], recentTasks: list, updatedAt };
  if (path === '/api/ceo/divisions') return empty ? [] : [division];
  if (path.startsWith('/api/ceo/divisions/')) return { ...division, members: empty ? [] : [member], projects: empty ? [] : [project], tasks: list };
  if (path.startsWith('/api/ceo/projects/')) return { ...project, tasks: list };
  if (path.startsWith('/api/ceo/tasks/')) return task;
  throw new Error(`Endpoint UI belum dipetakan: ${path}`);
}
