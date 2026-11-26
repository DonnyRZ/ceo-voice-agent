import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { devAdminEmail as adminEmail } from '../db/admin-account.js';
import { prepareAdminFixture } from './admin-fixture.js';

type Fixture = Awaited<ReturnType<typeof prepareAdminFixture>>;
type Session = Awaited<ReturnType<Fixture['login']>>;
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type Division = { id: string; name: string; version: number };
type User = { id: string; name: string; email: string; role: string; status: string; divisionId: string | null; version: number };
type Task = { id: string; version: number; picId: string; picName: string };

const invitationPath = '/api/admin/invitations';
const usersPath = '/api/admin/users';
const divisionsPath = '/api/admin/divisions';
const email = `undangan-${randomUUID().slice(0, 8)}@ruangkerja.test`;

describe('API undangan dan akses Superadmin', () => {
  let fixture: Fixture;
  let admin: Session;
  const links: string[] = [];

  beforeAll(async () => {
    fixture = await prepareAdminFixture({
      sendInvitation: async ({ email: recipient, activationUrl }) => {
        expect(recipient).toBe(email);
        links.push(activationUrl);
        if (links.length === 1) throw new Error('Pengiriman SMTP sementara gagal.');
      },
    });
    admin = await fixture.login(adminEmail);
  }, 45_000);

  afterAll(async () => { await fixture?.close(); });

  function inject(method: Method, url: string, headers: Session | undefined, payload?: object) {
    return fixture.app.inject({ method, url, headers: headers ?? { origin: fixture.config.APP_ORIGIN }, payload });
  }

  async function result<T>(method: Method, url: string, headers: Session | undefined, payload?: object, status = 200) {
    const response = await inject(method, url, headers, payload);
    expect(response.statusCode, `${method} ${url}`).toBe(status);
    return response.json<T>();
  }

  function token(index: number) {
    const url = new URL(links[index]);
    expect(url.pathname).toBe('/activate');
    expect(url.searchParams.has('token')).toBe(false);
    const value = new URLSearchParams(url.hash.slice(1)).get('token');
    if (!value) throw new Error('Link pengujian tidak memuat token aktivasi.');
    return value;
  }

  test('mengulang undangan gagal, mengaktifkan sekali, lalu mencabut akses dengan riwayat utuh', async () => {
    const source = await result<Division>('POST', divisionsPath, admin, {
      name: 'Divisi riwayat QA', description: 'Divisi sementara untuk pengujian riwayat.',
    }, 201);
    const divisions = await result<Division[]>('GET', divisionsPath, admin);
    const destination = divisions.find(({ name }) => name === 'Finance')!;
    expect(destination.id).not.toBe(source.id);

    const invite = { email, role: 'member', divisionId: source.id };
    const member = await fixture.login('doni@ruangkerja.test');
    expect((await inject('POST', invitationPath, member, invite)).statusCode).toBe(403);
    expect((await inject('POST', invitationPath, undefined, invite)).statusCode).toBe(401);
    const invalid = await inject('POST', invitationPath, admin, { ...invite, divisionId: null });
    expect(invalid.statusCode).toBe(400);
    const failed = await result<User>('POST', invitationPath, admin, invite, 201);
    expect(failed).toMatchObject({ email, status: 'failed', divisionId: source.id });
    expect(await result<User>('GET', `${usersPath}/${failed.id}`, admin)).toMatchObject({ status: 'failed' });
    expect(links).toHaveLength(1);
    const oldToken = token(0);
    expect(JSON.stringify(failed).includes(oldToken)).toBe(false);
    const persistedFailure = await fixture.db.query<{ status: string; token_hash: string }>(
      'SELECT status, token_hash FROM invitations WHERE id = $1', [failed.id],
    );
    expect(persistedFailure.rows[0].status).toBe('failed');
    expect(/^[0-9a-f]{64}$/.test(persistedFailure.rows[0].token_hash)).toBe(true);
    expect(persistedFailure.rows[0].token_hash === oldToken).toBe(false);
    expect((await inject('POST', invitationPath, admin, invite)).statusCode).toBe(409);

    const name = 'Anggota Undangan QA';
    const password = `QA-Aktivasi-${randomUUID()}`;
    const activationData = { token: oldToken, name, password };
    const attempt = await inject('POST', '/api/activate', undefined, activationData);
    expect(attempt.statusCode).toBeGreaterThanOrEqual(400);
    expect(attempt.statusCode).toBeLessThan(500);

    const delivered = await result<User>('POST', `${invitationPath}/${failed.id}/retry`, admin, { version: failed.version });
    expect(delivered).toMatchObject({ status: 'pending', id: failed.id });
    expect(links).toHaveLength(2);
    const currentToken = token(1);
    expect(currentToken === oldToken).toBe(false);
    const persistedRetry = await fixture.db.query<{ status: string; token_hash: string }>(
      'SELECT status, token_hash FROM invitations WHERE id = $1', [failed.id],
    );
    expect(persistedRetry.rows[0].status).toBe('pending');
    expect(persistedRetry.rows[0].token_hash === persistedFailure.rows[0].token_hash).toBe(false);
    const obsolete = await inject('POST', '/api/activate', undefined, activationData);
    expect(obsolete.statusCode).toBeGreaterThanOrEqual(400);
    expect(obsolete.statusCode).toBeLessThan(500);
    const activation = { ...activationData, token: currentToken };
    const contenders = await Promise.all([
      inject('POST', '/api/activate', undefined, activation),
      inject('POST', '/api/activate', undefined, activation),
    ]);
    expect(contenders.filter(({ statusCode }) => statusCode === 201)).toHaveLength(1);
    expect(contenders.find(({ statusCode }) => statusCode === 201)?.json()).toMatchObject({ email });
    const conflict = contenders.find(({ statusCode }) => statusCode !== 201)!;
    expect(conflict.statusCode).toBeGreaterThanOrEqual(400);
    expect(conflict.statusCode).toBeLessThan(500);
    const replay = await inject('POST', '/api/activate', undefined, activation);
    expect(replay.statusCode).toBeGreaterThanOrEqual(400);
    expect(replay.statusCode).toBeLessThan(500);
    expect((await inject('POST', invitationPath, admin, { ...invite, email: email.toUpperCase() })).statusCode).toBe(409);

    const query = new URLSearchParams({ search: email, status: 'active', divisionId: source.id });
    const [active] = await result<User[]>('GET', `${usersPath}?${query}`, admin);
    expect(active).toMatchObject({ email, name, role: 'member', status: 'active', divisionId: source.id });
    const invited = await fixture.login(email, password);
    const [pic] = await result<{ id: string }[]>('GET', '/api/members', invited);
    const project = await result<{ id: string }>('POST', '/api/projects', invited, { name: 'Proyek riwayat QA' }, 201);
    const draft = {
      date: '2026-11-26', title: 'Tugas historis QA', description: 'Riwayat harus tetap terbaca.',
      projectId: project.id, picId: pic.id, status: 'pending',
    };
    const task = await result<Task>('POST', '/api/tasks', invited, draft, 201);
    await result('PATCH', `/api/tasks/${task.id}`, invited, { ...draft, version: task.version, status: 'on_progress' });

    const archivePath = `${divisionsPath}/${source.id}?version=${source.version}`;
    const blocked = await inject('DELETE', archivePath, admin);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ members: [expect.objectContaining({ email })] });

    const accountPath = `${usersPath}/${active.id}`;
    const promote = { role: 'superadmin', divisionId: null, version: active.version };
    const promoted = await result<User>('PATCH', accountPath, admin, promote);
    expect(promoted).toMatchObject({ role: 'superadmin', divisionId: null });
    expect((await inject('PATCH', accountPath, admin, promote)).statusCode).toBe(409);
    const elevated = await fixture.login(email, password);
    expect((await inject('GET', '/api/admin/dashboard', elevated)).statusCode).toBe(200);

    const moved = await result<User>('PATCH', accountPath, admin, {
      role: 'member', divisionId: destination.id, version: promoted.version,
    });
    expect(moved).toMatchObject({ role: 'member', divisionId: destination.id });
    const transferred = await fixture.login(email, password);
    expect(await result('GET', '/api/session', transferred)).toMatchObject({ user: { divisionName: 'Finance' } });
    expect((await inject('GET', `/api/tasks/${task.id}`, transferred)).statusCode).toBe(404);
    expect((await inject('GET', '/api/admin/dashboard', transferred)).statusCode).toBe(403);

    expect(await result('DELETE', archivePath, admin)).toMatchObject({ status: 'archived' });
    const records = await result('GET', `/api/admin/tasks?divisionId=${source.id}`, admin);
    expect(records).toEqual([expect.objectContaining({ id: task.id, picId: task.picId, picName: name })]);
    expect(await result('GET', `/api/admin/tasks/${task.id}/history`, admin)).toEqual(expect.arrayContaining([
      expect.objectContaining({ previousStatus: 'pending', status: 'on_progress', actorName: name }),
    ]));

    expect(await result('DELETE', accountPath, admin, { version: moved.version })).toMatchObject({ status: 'revoked' });
    expect((await inject('GET', '/api/session', transferred)).statusCode).toBe(401);
    const rejected = await fixture.app.inject({
      method: 'POST', url: '/api/auth/sign-in/email', headers: { origin: fixture.config.APP_ORIGIN },
      payload: { email, password },
    });
    expect(rejected.statusCode).toBeGreaterThanOrEqual(400);
    expect(rejected.statusCode).toBeLessThan(500);

    const audit = await result('GET', `/api/admin/audit?actor=${encodeURIComponent(adminEmail)}`, admin);
    expect(audit).toEqual(expect.arrayContaining([expect.objectContaining({
      actorEmail: adminEmail,
      before: expect.objectContaining({ role: 'member' }), after: expect.objectContaining({ role: 'superadmin' }),
    })]));
  }, 30_000);
});
