import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { devAdminEmail } from '../db/admin-account.js';
import { it as itDivision } from '../db/seed-data.js';
import { interpretation, prepareCeoIntegration, type CeoIntegration } from './ceo-integration-fixture.js';

type Account = { id: string; version: number; role: string };
type Division = { id: string; name: string; description: string; version: number; status: string };

describe('batas akses integrasi ketiga peran', () => {
  let fixture: CeoIntegration;
  beforeAll(async () => { fixture = await prepareCeoIntegration(); }, 45_000);
  afterAll(async () => { await fixture?.close(); });

  test('CEO hanya membaca, anggota divisi terisolasi, dan tiap peran tidak memperoleh API peran lain', async () => {
    const { task } = await fixture.createWork();
    const { app, member, finance, admin, ceo } = fixture;
    for (const headers of [member, finance, admin]) {
      expect((await app.inject({ url: '/api/ceo/dashboard', headers })).statusCode).toBe(403);
      expect((await app.inject({ url: `/api/ceo/tasks/${task.id}`, headers })).statusCode).toBe(403);
    }
    expect((await app.inject({ url: `/api/tasks/${task.id}`, headers: finance })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/admin/dashboard', headers: ceo })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/tasks', headers: ceo })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/tasks', headers: ceo, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/api/tasks/${task.id}`, headers: ceo, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/api/ceo/tasks/${task.id}`, headers: ceo, payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/ceo/dashboard' })).statusCode).toBe(401);
    for (const headers of [member, admin, ceo]) {
      expect((await app.inject({ method: 'GET', url: '/api/session', headers })).statusCode).toBe(200);
    }
  });

  test('perubahan member menjadi CEO lalu kembali member mencabut sesi lama dan memperbarui otoritas', async () => {
    const { request, admin, login, app } = fixture;
    const member = await login('hakim@ruangkerja.test');
    const { user } = await request<{ user: { id: string } }>('/api/session', member);
    const account = await request<Account>(`/api/admin/users/${user.id}`, admin);
    const promoted = await request<Account>(`/api/admin/users/${user.id}`, admin, 'PATCH', {
      role: 'ceo', divisionId: null, version: account.version,
    });
    expect((await app.inject({ url: '/api/session', headers: member })).statusCode).toBe(401);
    const ceo = await login('hakim@ruangkerja.test');
    expect((await app.inject({ url: '/api/ceo/dashboard', headers: ceo })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/tasks', headers: ceo })).statusCode).toBe(403);
    await request(`/api/admin/users/${user.id}`, admin, 'PATCH', { role: 'member', divisionId: itDivision, version: promoted.version });
    expect((await app.inject({ url: '/api/ceo/dashboard', headers: ceo })).statusCode).toBe(401);
    const restored = await login('hakim@ruangkerja.test');
    expect((await app.inject({ url: '/api/tasks', headers: restored })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/ceo/dashboard', headers: restored })).statusCode).toBe(403);
  });

  test('arsip divisi kosong terlihat konsisten tanpa menghapus catatan divisi lain', async () => {
    const { request, admin, ceo } = fixture;
    const name = `Divisi Integrasi ${randomUUID().slice(0, 8)}`;
    const division = await request<Division>('/api/admin/divisions', admin, 'POST', { name, description: 'Awal.' }, 201);
    expect(await request(`/api/ceo/divisions/${division.id}`, ceo)).toMatchObject({ id: division.id, status: 'active' });
    const updated = await request<Division>(`/api/admin/divisions/${division.id}`, admin, 'PATCH', {
      name: `${name} Final`, description: 'Deskripsi terbaru.', version: division.version,
    });
    expect(await request(`/api/ceo/divisions/${division.id}`, ceo)).toMatchObject({ name: updated.name, description: updated.description });
    await request(`/api/admin/divisions/${division.id}?version=${updated.version}`, admin, 'DELETE');
    expect(await request(`/api/ceo/divisions?status=archived&search=${encodeURIComponent(name)}`, ceo))
      .toEqual([expect.objectContaining({ id: division.id, status: 'archived', name: updated.name })]);
    expect(await request('/api/ceo/divisions?status=active', ceo))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: division.id })]));
    expect(await request(`/api/ceo/divisions/${itDivision}`, ceo)).toMatchObject({ id: itDivision, status: 'active' });
  });

  test('logout mencabut cookie ketiga peran dan menghentikan akses retrieval sesi CEO lama', async () => {
    const { app, request, member, admin, ceo } = fixture;
    const { task } = await fixture.createWork();
    for (const [headers, url] of [[member, '/api/tasks'], [admin, '/api/admin/dashboard'], [ceo, '/api/ceo/dashboard']] as const) {
      await request('/api/auth/sign-out', headers, 'POST');
      expect((await app.inject({ url, headers })).statusCode).toBe(401);
      expect((await app.inject({ url: '/api/session', headers })).statusCode).toBe(401);
    }
    await expect(fixture.retrieve(`Apa status tugas ${task.title}?`, interpretation({ subject: task.title, workKind: 'task' })))
      .rejects.toThrow('Sesi CEO sudah dicabut.');
    const freshAdmin = await fixture.login(devAdminEmail);
    expect((await app.inject({ url: '/api/admin/dashboard', headers: freshAdmin })).statusCode).toBe(200);
  });
});
