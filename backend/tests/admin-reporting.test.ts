import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { devAdminEmail } from '../db/admin-account.js';
import { firstTaskId } from '../db/seed-data.js';
import { prepareAdminFixture } from './admin-fixture.js';

type Fixture = Awaited<ReturnType<typeof prepareAdminFixture>>;
type Session = Awaited<ReturnType<Fixture['login']>>;
type Division = { id: string; name: string; code: string; description: string; version: number; status: string };
type ReportTask = { id: string; divisionId: string; divisionName: string; picId: string; projectId: string; status: string };
type Audit = {
  id: string;
  actorName: string;
  actorEmail: string;
  recordId: string;
  action: string;
  entity: string;
  before: { status?: string; name?: string } | null;
  after: { status?: string; name?: string } | null;
};

describe('API laporan, divisi, dan audit Superadmin', () => {
  let fixture: Fixture;
  let admin: Session;
  let member: Session;

  beforeAll(async () => {
    fixture = await prepareAdminFixture();
    admin = await fixture.login(devAdminEmail);
    member = await fixture.login('doni@ruangkerja.test');
  }, 45_000);

  afterAll(async () => { await fixture?.close(); });

  test('menolak akses Superadmin dari sesi anggota dan permintaan tanpa sesi', async () => {
    const id = randomUUID();
    const operations = [
      ['GET', '/api/admin/dashboard'], ['GET', '/api/admin/tasks'], ['GET', `/api/admin/tasks/${firstTaskId}`],
      ['GET', `/api/admin/tasks/${firstTaskId}/history`], ['GET', '/api/admin/audit'], ['GET', '/api/admin/audit/1'],
      ['GET', '/api/admin/divisions'], ['GET', `/api/admin/divisions/${id}`], ['POST', '/api/admin/divisions'],
      ['PATCH', `/api/admin/divisions/${id}`], ['DELETE', `/api/admin/divisions/${id}`],
      ['GET', '/api/admin/users'], ['GET', `/api/admin/users/${id}`], ['PATCH', `/api/admin/users/${id}`],
      ['DELETE', `/api/admin/users/${id}`], ['POST', '/api/admin/invitations'], ['POST', `/api/admin/invitations/${id}/retry`],
    ] as const;
    for (const [method, url] of operations) {
      expect((await fixture.app.inject({ method, url })).statusCode, `${method} ${url}`).toBe(401);
      expect((await fixture.app.inject({ method, url, headers: member })).statusCode, `${method} ${url}`).toBe(403);
    }
    const session = await fixture.app.inject({ url: '/api/session', headers: admin });
    expect(session.json()).toMatchObject({ user: { role: 'superadmin' } });
  });

  test('menghitung dan menyaring timesheet lintas divisi serta menampilkan riwayat dan audit', async () => {
    const period = new URLSearchParams({ from: '2026-11-01', to: '2026-11-30' });
    const report = await fixture.app.inject({ url: `/api/admin/tasks?${period}`, headers: admin });
    expect(report.statusCode).toBe(200);
    const tasks = report.json<ReportTask[]>();
    expect(tasks.map(({ divisionName }) => divisionName)).toEqual(expect.arrayContaining(['IT', 'Finance']));
    const first = tasks.find(({ id }) => id === firstTaskId)!;
    expect(first).toMatchObject({ divisionName: 'IT', status: 'on_progress' });

    const dashboard = await fixture.app.inject({ url: `/api/admin/dashboard?${period}`, headers: admin });
    expect(dashboard.statusCode).toBe(200);
    const totals = Object.fromEntries(['pending', 'on_progress', 'done'].map((status) => [
      status, tasks.filter((task) => task.status === status).length,
    ]));
    expect(dashboard.json()).toMatchObject({ counts: { tasks: tasks.length }, byStatus: totals });

    const filters = new URLSearchParams({
      from: '2026-11-26', to: '2026-11-26', divisionId: first.divisionId, picId: first.picId,
      projectId: first.projectId, status: 'on_progress', search: 'Validasi alur login',
    });
    const selected = await fixture.app.inject({ url: `/api/admin/tasks?${filters}`, headers: admin });
    expect(selected.json()).toEqual([expect.objectContaining({ id: firstTaskId })]);
    const invalid = await fixture.app.inject({ url: '/api/admin/tasks?from=2026-12-01&to=2026-11-01', headers: admin });
    expect(invalid.statusCode).toBe(400);

    const detail = await fixture.app.inject({ url: `/api/admin/tasks/${firstTaskId}`, headers: admin });
    expect(detail.json()).toMatchObject({ id: firstTaskId, divisionName: 'IT', title: 'Validasi alur login' });
    const history = await fixture.app.inject({ url: `/api/admin/tasks/${firstTaskId}/history`, headers: admin });
    expect(history.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ previousStatus: 'pending', status: 'on_progress', actorName: 'Doni' }),
    ]));
    const patch = await fixture.app.inject({ method: 'PATCH', url: `/api/admin/tasks/${firstTaskId}`, headers: admin, payload: {} });
    expect(patch.statusCode).toBe(404);

    const audit = await fixture.app.inject({ url: '/api/admin/audit?actor=Doni&action=UPDATE&entity=task', headers: admin });
    expect(audit.statusCode).toBe(200);
    const change = audit.json<Audit[]>().find(({ recordId }) => recordId === firstTaskId)!;
    expect(change).toMatchObject({ actorName: 'Doni', actorEmail: 'doni@ruangkerja.test', action: 'UPDATE', entity: 'task' });
    const entry = await fixture.app.inject({ url: `/api/admin/audit/${change.id}`, headers: admin });
    expect(entry.json()).toMatchObject({ before: { status: 'pending' }, after: { status: 'on_progress' } });
  });

  test('validasi, edit dengan versi, dan arsip divisi dengan jejak audit', async () => {
    const base = '/api/admin/divisions';
    const name = `Divisi QA ${randomUUID().slice(0, 8)}`;
    const invalid = await fixture.app.inject({ method: 'POST', url: base, headers: admin, payload: { name: ' ' } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toHaveProperty('fields.name');

    const response = await fixture.app.inject({ method: 'POST', url: base, headers: admin, payload: { name, description: 'Awal' } });
    expect(response.statusCode).toBe(201);
    const result = response.json<Division>();
    expect(result).toMatchObject({ name, description: 'Awal', status: 'active', code: expect.any(String) });
    const duplicate = await fixture.app.inject({ method: 'POST', url: base, headers: admin, payload: { name, description: 'Duplikasi' } });
    expect(duplicate.statusCode).toBe(409);

    const url = `${base}/${result.id}`;
    const payload = { name, description: 'Terbaru', version: result.version };
    const update = await fixture.app.inject({ method: 'PATCH', url, headers: admin, payload });
    expect(update.statusCode).toBe(200);
    const latest = update.json<Division>();
    expect(latest).toMatchObject({ description: 'Terbaru', version: result.version + 1 });
    const stale = await fixture.app.inject({ method: 'PATCH', url, headers: admin, payload });
    expect(stale.statusCode).toBe(409);

    const archive = await fixture.app.inject({ method: 'DELETE', url: `${url}?version=${latest.version}`, headers: admin });
    expect(archive.statusCode).toBe(200);
    expect(archive.json()).toMatchObject({ id: result.id, status: 'archived' });
    const archived = await fixture.app.inject({ url: `${base}?status=archived&search=${encodeURIComponent(name)}`, headers: admin });
    expect(archived.json()).toEqual([expect.objectContaining({ id: result.id, description: 'Terbaru' })]);
    const entry = await fixture.app.inject({ url: '/api/admin/audit?entity=division&action=UPDATE', headers: admin });
    expect(entry.json()).toEqual(expect.arrayContaining([expect.objectContaining({
      recordId: result.id, actorEmail: devAdminEmail,
      before: expect.objectContaining({ description: 'Awal' }), after: expect.objectContaining({ description: 'Terbaru' }),
    })]));
  });
});
