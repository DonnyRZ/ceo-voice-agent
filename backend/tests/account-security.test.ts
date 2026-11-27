import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { devCeoEmail } from '../db/admin-account.js';
import { prepareAdminFixture } from './admin-fixture.js';

describe('Keamanan akun terautentikasi', () => {
  let fixture: Awaited<ReturnType<typeof prepareAdminFixture>>;
  beforeAll(async () => {
    fixture = await prepareAdminFixture({ databasePoolMax: 1, authorizationPoolMax: 1 });
  }, 30_000);
  afterAll(async () => fixture?.close(), 15_000);

  it('menolak pengunjung, input tidak valid, dan asal berbeda', async () => {
    const { app, login } = fixture;
    const url = '/api/account/password';
    const payload = { currentPassword: process.env.SEED_PASSWORD, newPassword: `QA-Baru-${randomUUID()}` };
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(401);
    const headers = await login(devCeoEmail);
    expect((await app.inject({ method: 'POST', url, headers, payload: { ...payload, newPassword: 'short' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url, headers, payload: { ...payload, userId: 'other-user' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url, headers: { ...headers, origin: 'https://other.example' }, payload })).statusCode).toBe(403);
    const invalid = await app.inject({ method: 'POST', url, headers, payload: { ...payload, currentPassword: 'wrong-password' } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ message: 'Kata sandi saat ini tidak sesuai.' });
    expect((await app.inject({ url: '/api/session', headers })).statusCode).toBe(200);
  });

  it('mengubah kata sandi melalui Better Auth dan mencabut sesi lama tanpa membocorkan token', async () => {
    const { app, login, config } = fixture;
    const headers = await login(devCeoEmail);
    const otherSession = await login(devCeoEmail);
    const nextPassword = `QA-Akun-${randomUUID()}`;
    const changed = await app.inject({ method: 'POST', url: '/api/account/password', headers,
      payload: { currentPassword: process.env.SEED_PASSWORD, newPassword: nextPassword } });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toEqual({ success: true });
    const setCookie = changed.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
    expect(cookies.some((cookie) => /; httponly/i.test(cookie))).toBe(true);
    const renewed = { cookie: cookies.map((cookie) => cookie.split(';')[0]).join('; ') };
    expect((await app.inject({ url: '/api/session', headers: renewed })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/session', headers })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/session', headers: otherSession })).statusCode).toBe(401);
    const oldLogin = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email',
      headers: { origin: config.APP_ORIGIN }, payload: { email: devCeoEmail, password: process.env.SEED_PASSWORD } });
    expect(oldLogin.statusCode).toBe(401);
    const nextSession = await login(devCeoEmail, nextPassword);
    expect((await app.inject({ url: '/api/session', headers: nextSession })).statusCode).toBe(200);
  });

  it('akun yang dicabut tidak dapat mengganti kata sandi walau cookie lama masih ada', async () => {
    const { app, login, db } = fixture;
    const headers = await login('doni@ruangkerja.test');
    const session = await app.inject({ url: '/api/session', headers });
    const { user } = session.json<{ user: { id: string } }>();
    await db.query("UPDATE account_access SET state = 'revoked' WHERE user_id = $1", [user.id]);
    const denied = await app.inject({ method: 'POST', url: '/api/account/password', headers,
      payload: { currentPassword: process.env.SEED_PASSWORD, newPassword: `QA-Revoked-${randomUUID()}` } });
    expect(denied.statusCode).toBe(401);
    const admission = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email',
      headers: { origin: fixture.config.APP_ORIGIN },
      payload: { email: 'doni@ruangkerja.test', password: process.env.SEED_PASSWORD } });
    expect(admission.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('pencabutan akses setelah admission awal membatalkan perubahan kata sandi', async () => {
    const { app, login, db } = fixture;
    const email = 'hakim@ruangkerja.test';
    const headers = await login(email);
    const session = await app.inject({ url: '/api/session', headers });
    const { user } = session.json<{ user: { id: string } }>();
    const locker = await db.connect();
    let settleRequest = async () => {};
    try {
      await locker.query('BEGIN');
      await locker.query('SELECT id FROM account WHERE "userId" = $1 FOR UPDATE', [user.id]);
      const pending = app.inject({ method: 'POST', url: '/api/account/password', headers,
        payload: { currentPassword: process.env.SEED_PASSWORD, newPassword: `QA-Revoke-Race-${randomUUID()}` } });
      settleRequest = async () => { await pending; };
      await expect.poll(async () => {
        const { rows: [state] } = await db.query<{ waiting: boolean }>(`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query LIKE 'update "account"%') AS waiting
        `);
        return state.waiting;
      }, { timeout: 5_000 }).toBe(true);
      await db.query("UPDATE account_access SET state = 'revoked' WHERE user_id = $1", [user.id]);
      await locker.query('ROLLBACK');
      const denied = await pending;
      expect(denied.statusCode).toBeGreaterThanOrEqual(400);
      expect(denied.headers['set-cookie']).toBeUndefined();
      expect((await app.inject({ url: '/api/session', headers })).statusCode).toBe(401);
    } finally {
      await locker.query('ROLLBACK');
      locker.release();
      await settleRequest();
      await db.query("UPDATE account_access SET state = 'active' WHERE user_id = $1", [user.id]);
    }
    // A failed Better Auth transaction must preserve the original credential.
    await login(email);
  }, 20_000);

  it('login dan pergantian kata sandi serentak tetap berjalan dengan satu koneksi pada setiap pool', async () => {
    const { app, login } = fixture;
    const accounts = ['hakim@ruangkerja.test', 'laura@ruangkerja.test', 'vanah@ruangkerja.test'];
    const headers = await Promise.all(accounts.map((email) => login(email)));
    const passwords = accounts.map(() => `QA-Concurrent-${randomUUID()}`);
    const changes = accounts.map((_, index) => app.inject({
      method: 'POST', url: '/api/account/password', headers: headers[index],
      payload: { currentPassword: process.env.SEED_PASSWORD, newPassword: passwords[index] },
    }));
    const [changed] = await Promise.all([Promise.all(changes), login('superadmin@ruangkerja.test')]);
    for (const response of changed) {
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({ success: true });
    }
    await Promise.all(accounts.map((email, index) => login(email, passwords[index])));
    for (const oldSession of headers) {
      expect((await app.inject({ url: '/api/session', headers: oldSession })).statusCode).toBe(401);
    }
  }, 20_000);
});
