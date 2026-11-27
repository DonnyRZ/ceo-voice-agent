import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { devAdminEmail, devCeoEmail } from '../db/admin-account.js';
import { finance, firstTaskId, it } from '../db/seed-data.js';
import type { AdminTask } from '../modules/admin/reports/task-report.js';
import { prepareAdminFixture } from './admin-fixture.js';

type Fixture = Awaited<ReturnType<typeof prepareAdminFixture>>;
type Session = Awaited<ReturnType<Fixture['login']>>;

describe('Kesegaran data dan batas akses laporan CEO', () => {
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

  test('perubahan tugas, PIC dan deskripsi langsung terlihat di CEO dan Superadmin', async () => {
    const { app } = fixture;
    const task = (await app.inject({ url: `/api/tasks/${firstTaskId}`, headers: member })).json<AdminTask>();
    const team = (await app.inject({ url: '/api/members', headers: member })).json<{ id: string; name: string }[]>();
    const hakim = team.find(({ name }) => name === 'Hakim')!;
    const updated = await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, headers: member,
      payload: { ...task, title: 'Validasi yang diperbarui', description: 'Deskripsi terbaru dari anggota divisi.',
        status: 'done', date: '2026-12-01', picId: hakim.id } });
    expect(updated.statusCode, updated.body).toBe(200);
    const source = updated.json<AdminTask>();
    const detail = await app.inject({ url: `/api/ceo/tasks/${task.id}`, headers: ceo });
    expect(detail.json()).toMatchObject({ ...source, divisionId: it, picName: 'Hakim' });
    const adminDetail = await app.inject({ url: `/api/admin/tasks/${task.id}`, headers: admin });
    expect(detail.json()).toEqual(adminDetail.json());
    const dashboard = await app.inject({ url: '/api/ceo/dashboard?from=2026-12-01&to=2026-12-01', headers: ceo });
    expect(dashboard.json()).toMatchObject({ counts: { tasks: 1 }, byStatus: { done: 1, pending: 0, on_progress: 0 },
      recentTasks: [expect.objectContaining({ id: task.id, description: source.description, picId: hakim.id })] });
    const oldPeriod = await app.inject({ url: '/api/ceo/tasks?from=2026-11-01&to=2026-11-30', headers: ceo });
    expect(oldPeriod.json()).not.toContainEqual(expect.objectContaining({ id: task.id }));
  });

  test('anggota aktif mengikuti perpindahan divisi, tanpa membuka akun pribadi atau hak tulis', async () => {
    const { app, db, config } = fixture;
    const users = (await app.inject({ url: '/api/admin/users', headers: admin }))
      .json<{ id: string; email: string; version: number }[]>();
    const hakim = users.find(({ email }) => email === 'hakim@ruangkerja.test')!;
    const moved = await app.inject({ method: 'PATCH', url: `/api/admin/users/${hakim.id}`, headers: admin,
      payload: { role: 'member', divisionId: finance, version: hakim.version } });
    expect(moved.statusCode, moved.body).toBe(200);
    const itDetail = await app.inject({ url: `/api/ceo/divisions/${it}`, headers: ceo });
    expect(itDetail.json()).toMatchObject({ memberCount: 1, members: [{ name: 'Doni' }] });
    const financeDetail = await app.inject({ url: `/api/ceo/divisions/${finance}`, headers: ceo });
    expect(financeDetail.json()).toMatchObject({ memberCount: 3 });
    expect(financeDetail.json().members).toContainEqual({ id: hakim.id, name: 'Hakim' });
    const { rows: [identity] } = await db.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [devCeoEmail]);
    const pool = new Pool({ connectionString: config.DATABASE_URL });
    const runtime = await pool.connect();
    try {
      await runtime.query('BEGIN');
      await runtime.query("SELECT set_config('app.user_id', $1, true)", [identity.id]);
      expect((await runtime.query('SELECT user_id FROM account_access')).rows).toEqual([{ user_id: identity.id }]);
      expect((await runtime.query('SELECT id FROM invitations')).rows).toEqual([]);
      const write = await runtime.query('UPDATE tasks SET title = title WHERE id = $1', [firstTaskId]);
      expect(write.rowCount).toBe(0);
      expect((await runtime.query('SELECT id FROM audit_log')).rows).toEqual([]);
      await runtime.query('ROLLBACK');
    } finally { runtime.release(); await pool.end(); }
  });

  test('arsip divisi tetap dapat dilihat dan sesi CEO yang dicabut langsung ditolak', async () => {
    const { app } = fixture;
    const created = await app.inject({ method: 'POST', url: '/api/admin/divisions', headers: admin,
      payload: { name: 'Divisi arsip untuk riwayat', description: 'Sumber riwayat tetap tersedia.' } });
    const division = created.json<{ id: string; version: number }>();
    expect(created.statusCode).toBe(201);
    const archived = await app.inject({ method: 'DELETE', url: `/api/admin/divisions/${division.id}?version=${division.version}`, headers: admin });
    expect(archived.statusCode).toBe(200);
    const listing = await app.inject({ url: '/api/ceo/divisions?status=archived', headers: ceo });
    expect(listing.json()).toContainEqual(expect.objectContaining({ id: division.id, status: 'archived', taskCount: 0 }));
    expect((await app.inject({ url: `/api/ceo/divisions/${division.id}`, headers: ceo })).statusCode).toBe(200);
    const users = (await app.inject({ url: '/api/admin/users', headers: admin })).json<{ id: string; email: string }[]>();
    const identity = users.find(({ email }) => email === devCeoEmail)!;
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/users/${identity.id}`, headers: admin })).statusCode).toBe(200);
    for (const path of ['/dashboard', '/divisions', `/tasks/${firstTaskId}`, `/tasks/${firstTaskId}/history`]) {
      expect((await app.inject({ url: `/api/ceo${path}`, headers: ceo })).statusCode).toBe(401);
    }
  });
});
