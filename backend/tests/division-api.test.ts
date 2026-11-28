import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { firstTaskId } from '../db/seed-data.js';
import { prepareAdminFixture } from './admin-fixture.js';

type RequestHeaders = { cookie: string; origin: string };
type RecordId = { id: string };
type ProjectDto = RecordId & { name: string; description: string; version: number; status: string };

describe('API Anggota Divisi dengan PostgreSQL', () => {
  let app: FastifyInstance;
  let it: RequestHeaders;
  let finance: RequestHeaders;
  let fixture: Awaited<ReturnType<typeof prepareAdminFixture>>;
  beforeAll(async () => {
    fixture = await prepareAdminFixture();
    app = fixture.app;
    it = await fixture.login('doni@ruangkerja.test');
    finance = await fixture.login('laura@ruangkerja.test');
  }, 30000);
  afterAll(async () => { await fixture?.close(); });

  test('memerlukan sesi dan membatasi daftar ke divisi anggota', async () => {
    const unauthorized = await app.inject('/api/tasks');
    expect(unauthorized.statusCode).toBe(401);

    const session = await app.inject({ url: '/api/session', headers: it });
    expect(session.json()).toMatchObject({ user: { name: 'Doni', divisionName: 'IT' } });
    expect(session.headers['cache-control']).toBe('no-store');
    const team = await app.inject({ url: '/api/members', headers: it });
    expect(team.json()).toEqual([
      { id: expect.any(String), name: 'Doni' },
      { id: expect.any(String), name: 'Hakim' },
    ]);

    const nextSession = await app.inject({ url: '/api/session', headers: finance });
    expect(nextSession.json()).toMatchObject({ user: { name: 'Laura', divisionName: 'Finance' } });
    const data = await app.inject({ url: '/api/tasks', headers: finance });
    expect(data.json()).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: firstTaskId })]));
    expect((await app.inject({ url: `/api/tasks/${firstTaskId}`, headers: finance })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/tasks/${firstTaskId}/history`, headers: finance })).statusCode).toBe(404);
  });

  test('menyaring berdasarkan rentang tanggal, PIC, proyek, dan status', async () => {
    const detail = await app.inject({ url: `/api/tasks/${firstTaskId}`, headers: it });
    expect(detail.statusCode).toBe(200);
    const { projectId, picId } = detail.json<{ projectId: string; picId: string }>();
    const params = new URLSearchParams({
      from: '2026-11-26', to: '2026-11-26', projectId, picId, status: 'on_progress',
    });
    const found = await app.inject({ url: `/api/tasks?${params}`, headers: it });
    expect(found.json()).toContainEqual(expect.objectContaining({ id: firstTaskId, date: '2026-11-26' }));

    const empty = await app.inject({ url: '/api/tasks?from=2026-01-01&to=2026-01-01', headers: it });
    expect(empty.json()).toEqual([]);
    const invalid = await app.inject({ url: '/api/tasks?from=2026-11-26&to=2026-11-12', headers: it });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toHaveProperty('fields.to');
  });

  test('memvalidasi kolom dan relasi tugas sebelum menyimpan', async () => {
    const [project] = (await app.inject({ url: '/api/projects', headers: finance })).json<RecordId[]>();
    const [pic] = (await app.inject({ url: '/api/members', headers: finance })).json<RecordId[]>();
    const body = { date: '2026-11-26', title: '   ', projectId: project.id, picId: pic.id, status: 'pending' };
    const invalid = await app.inject({ method: 'POST', url: '/api/tasks', headers: it, payload: body });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toHaveProperty('fields.title', 'Masukkan judul tugas.');

    const foreign = await app.inject({
      method: 'POST', url: '/api/tasks', headers: it, payload: { ...body, title: 'Uji relasi' },
    });
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json()).toHaveProperty('fields.projectId');
    expect(foreign.json()).toHaveProperty('fields.picId');
  });

  test('menyimpan proyek, menjaga revisi, dan mempertahankan status saat nama berubah', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/projects', headers: it,
      payload: { name: `Uji proyek ${randomUUID()}`, status: 'on_progress' },
    });
    expect(response.statusCode, response.body).toBe(201);
    const project = response.json<ProjectDto>();
    const url = `/api/projects/${project.id}`;
    expect((await app.inject({ url, headers: finance })).statusCode).toBe(404);

    const payload = { name: project.name, description: 'Deskripsi proyek terbaru', version: project.version };
    const updated = await app.inject({ method: 'PATCH', url, headers: it, payload });
    expect(updated.json()).toMatchObject({ description: payload.description, version: 2, status: 'on_progress' });
    const stale = await app.inject({ method: 'PATCH', url, headers: it, payload });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ current: { id: project.id, version: 2 } });
  });

  test('mengizinkan satu edit bersamaan dan mencatat transisi status', async () => {
    const [project] = (await app.inject({ url: '/api/projects', headers: it })).json<RecordId[]>();
    const [pic] = (await app.inject({ url: '/api/members', headers: it })).json<RecordId[]>();
    const payload = {
      title: `Uji revisi ${randomUUID()}`, description: 'Catatan pengujian',
      date: '2026-10-08', projectId: project.id, picId: pic.id, status: 'pending',
    };
    const saved = await app.inject({ method: 'POST', url: '/api/tasks', headers: it, payload });
    expect(saved.statusCode, saved.body).toBe(201);
    const task = saved.json<RecordId & { version: number }>();
    const url = `/api/tasks/${task.id}`;
    const contenders = await Promise.all(['on_progress', 'done'].map((status) =>
      app.inject({ method: 'PATCH', url, headers: it, payload: { ...payload, status, version: task.version } }),
    ));
    expect(contenders.map(({ statusCode }) => statusCode).sort()).toEqual([200, 409]);

    const committed = contenders.find(({ statusCode }) => statusCode === 200)?.json();
    const rejected = contenders.find(({ statusCode }) => statusCode === 409)?.json();
    expect(rejected.current).toEqual(committed);
    const history = await app.inject({ url: `${url}/history`, headers: it });
    expect(history.json()).toMatchObject([{ previousStatus: 'pending', status: committed.status, actorName: 'Doni' }]);
  });

  test('membatasi mutasi berdasarkan origin dan mencabut sesi saat keluar', async () => {
    const blocked = await app.inject({
      method: 'POST', url: '/api/projects', headers: { ...it, origin: 'https://example.com' },
      payload: { name: 'Tidak tersimpan' },
    });
    expect(blocked.statusCode).toBe(403);
    const session = await fixture.login('doni@ruangkerja.test');
    const logout = await app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: session });
    expect(logout.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/session', headers: session })).statusCode).toBe(401);
  });
});
