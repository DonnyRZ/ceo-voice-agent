import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { devAdminEmail, devCeoEmail } from '../db/admin-account.js';
import { firstTaskId, it } from '../db/seed-data.js';
import type { CeoDivision, CeoProject, StatusCounts } from '../modules/ceo/types.js';
import type { AdminTask } from '../modules/admin/reports/task-report.js';
import { prepareAdminFixture } from './admin-fixture.js';

type Fixture = Awaited<ReturnType<typeof prepareAdminFixture>>;
type Session = Awaited<ReturnType<Fixture['login']>>;

describe('Laporan CEO lintas divisi yang hanya dapat dibaca', () => {
  let fixture: Fixture;
  let ceo: Session;
  let admin: Session;
  let member: Session;

  beforeAll(async () => {
    fixture = await prepareAdminFixture();
    ceo = await fixture.login(devCeoEmail);
    admin = await fixture.login(devAdminEmail);
    member = await fixture.login('doni@ruangkerja.test');
  }, 45_000);
  afterAll(async () => { await fixture?.close(); });

  test('semua endpoint memerlukan CEO aktif dan tidak menyediakan mutasi', async () => {
    const paths = ['/dashboard', '/divisions', `/divisions/${it}`, `/projects/${randomUUID()}`,
      '/tasks', `/tasks/${firstTaskId}`, `/tasks/${firstTaskId}/history`];
    for (const path of paths) {
      const url = `/api/ceo${path}`;
      expect((await fixture.app.inject({ url })).statusCode, url).toBe(401);
      for (const headers of [admin, member]) {
        expect((await fixture.app.inject({ url, headers })).statusCode, url).toBe(403);
      }
    }
    for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
      const response = await fixture.app.inject({ method, url: `/api/ceo/tasks/${firstTaskId}`, headers: ceo });
      expect(response.statusCode).toBe(404);
    }
  });

  test('dashboard dan rincian menampilkan data sumber utuh dan agregasi periode yang sama', async () => {
    const { app } = fixture;
    const query = '?from=2026-11-01&to=2026-11-30';
    const taskResponse = await app.inject({ url: `/api/ceo/tasks${query}`, headers: ceo });
    expect(taskResponse.statusCode).toBe(200);
    const tasks = taskResponse.json<AdminTask[]>();
    expect(tasks).toHaveLength(11);
    const expected = Object.fromEntries(['pending', 'on_progress', 'done'].map((status) =>
      [status, tasks.filter((task) => task.status === status).length]));
    const response = await app.inject({ url: `/api/ceo/dashboard${query}`, headers: ceo });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const dashboard = response.json<{ counts: object; byStatus: StatusCounts; recentTasks: AdminTask[] }>();
    expect(dashboard).toMatchObject({ counts: { divisions: 2, projects: 4, tasks: 11, members: 4 }, byStatus: expected });
    expect(dashboard.recentTasks).toHaveLength(8);
    expect(tasks.map(({ divisionName }) => divisionName)).toEqual(expect.arrayContaining(['IT', 'Finance']));
    const expectedRecent = [...tasks].sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() || a.id.localeCompare(b.id)).slice(0, 8);
    expect(dashboard.recentTasks).toEqual(expectedRecent);
    const updateTimes = dashboard.recentTasks.map(({ updatedAt }) => new Date(updatedAt).getTime());
    expect(updateTimes).toEqual([...updateTimes].sort((a, b) => b - a));

    const division = (await app.inject({ url: `/api/ceo/divisions/${it}${query}`, headers: ceo }))
      .json<CeoDivision & { members: { id: string; name: string }[]; projects: CeoProject[]; tasks: AdminTask[] }>();
    expect(division).toMatchObject({ id: it, memberCount: 2, projectCount: 3, taskCount: 10, progress: 50 });
    expect(division.members).toEqual([{ id: expect.any(String), name: 'Doni' }, { id: expect.any(String), name: 'Hakim' }]);
    expect(division.tasks.every(({ divisionId }) => divisionId === it)).toBe(true);
    const task = tasks.find(({ id }) => id === firstTaskId)!;
    const project = (await app.inject({ url: `/api/ceo/projects/${task.projectId}${query}`, headers: ceo }))
      .json<CeoProject & { tasks: AdminTask[] }>();
    expect(project).toMatchObject({ id: task.projectId, divisionName: 'IT', taskCount: 2, progress: 50 });
    expect(project.picNames).toEqual(expect.arrayContaining(['Doni', 'Hakim']));
    const detail = await app.inject({ url: `/api/ceo/tasks/${firstTaskId}`, headers: ceo });
    expect(detail.json()).toMatchObject({ ...task, description: 'Uji akses dan pesan gagal.' });
    const history = await app.inject({ url: `/api/ceo/tasks/${firstTaskId}/history`, headers: ceo });
    expect(history.json()).toContainEqual(expect.objectContaining({ previousStatus: 'pending', status: 'on_progress', actorName: 'Doni' }));
  });

  test('memvalidasi filter, tanggal inklusif, hasil kosong dan sumber yang tidak ditemukan', async () => {
    const { app } = fixture;
    for (const path of ['/dashboard', '/divisions', `/divisions/${it}`, `/projects/${randomUUID()}`, '/tasks']) {
      const result = await app.inject({ url: `/api/ceo${path}?from=2026-12-01&to=2026-11-01`, headers: ceo });
      expect(result.statusCode, path).toBe(400);
    }
    for (const filter of ['status=unknown', 'divisionId=invalid', 'from=0000-01-01', 'from=not-a-date']) {
      expect((await app.inject({ url: `/api/ceo/tasks?${filter}`, headers: ceo })).statusCode).toBe(400);
    }
    const task = (await app.inject({ url: `/api/ceo/tasks/${firstTaskId}`, headers: ceo })).json<AdminTask>();
    const filters = new URLSearchParams({ from: '2026-11-26', to: '2026-11-26', divisionId: it,
      projectId: task.projectId, picId: task.picId, status: task.status, search: 'pesan gagal' });
    expect((await app.inject({ url: `/api/ceo/tasks?${filters}`, headers: ceo })).json()).toEqual([task]);
    const division = await app.inject({ url: '/api/ceo/divisions?search=finance&status=active', headers: ceo });
    expect(division.json()).toEqual([expect.objectContaining({ name: 'Finance' })]);
    const empty = await app.inject({ url: '/api/ceo/dashboard?from=2020-01-01&to=2020-01-01', headers: ceo });
    expect(empty.json()).toMatchObject({ counts: { tasks: 0, members: 4, projects: 4 },
      byStatus: { pending: 0, on_progress: 0, done: 0 }, recentTasks: [] });
    for (const path of [`/divisions/${randomUUID()}`, `/projects/${randomUUID()}`, `/tasks/${randomUUID()}`, '/tasks/invalid']) {
      expect((await app.inject({ url: `/api/ceo${path}`, headers: ceo })).statusCode).toBe(404);
    }
  });
});
