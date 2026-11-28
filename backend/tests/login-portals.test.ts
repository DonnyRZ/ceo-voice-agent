import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { devAdminEmail, devCeoEmail } from '../db/admin-account.js';
import { prepareAdminFixture } from './admin-fixture.js';

describe('Portal login terpisah dan admission sebelum sesi dibuat', () => {
  let fixture: Awaited<ReturnType<typeof prepareAdminFixture>>;
  const userEndpoint = '/api/auth/sign-in/email';
  const adminEndpoint = '/api/superadmin/auth/sign-in/email';
  beforeAll(async () => { fixture = await prepareAdminFixture(); }, 30_000);
  afterAll(async () => fixture?.close(), 15_000);

  function signIn(url: string, email: string, extra: Record<string, unknown> = {}, headers = {}) {
    return fixture.app.inject({ method: 'POST', url,
      headers: { origin: fixture.config.APP_ORIGIN, ...headers },
      payload: { email, password: process.env.SEED_PASSWORD, ...extra } });
  }
  async function sessionCount() {
    const { rows: [row] } = await fixture.db.query<{ count: number }>('SELECT count(*)::int AS count FROM session');
    return row.count;
  }
  it.each([
    [userEndpoint, devAdminEmail], [adminEndpoint, devCeoEmail], [adminEndpoint, 'doni@ruangkerja.test'],
  ])('menolak akun pada portal yang salah tanpa menyimpan sesi: %s %s', async (url, email) => {
    const before = await sessionCount();
    const response = await signIn(url, email);
    expect(response.statusCode).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.json()).toEqual({ message: 'Email atau kata sandi tidak sesuai.' });
    expect(await sessionCount()).toBe(before);
  });
  it.each([
    [adminEndpoint, devAdminEmail, 'superadmin'], [userEndpoint, devCeoEmail, 'ceo'],
    [userEndpoint, 'doni@ruangkerja.test', 'member'],
  ])('menerima peran yang sesuai dan cookie HttpOnly: %s %s', async (url, email, role) => {
    const response = await signIn(url, email);
    expect(response.statusCode).toBe(200);
    const cookies = response.cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
    expect(response.cookies.some((cookie) => cookie.httpOnly)).toBe(true);
    const session = await fixture.app.inject({ url: '/api/session', headers: { cookie: cookies } });
    expect(session.json()).toMatchObject({ user: { role } });
  });
  it('tidak mempercayai role, portal, referrer, atau header dari klien', async () => {
    const before = await sessionCount();
    const response = await signIn(userEndpoint, devAdminEmail,
      { role: 'member', portal: 'superadmin' }, { 'x-login-portal': 'superadmin', referer: `${fixture.config.APP_ORIGIN}/superadmin` });
    expect(response.statusCode).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(await sessionCount()).toBe(before);
  });
  it('menjaga konteks admission terpisah pada login serentak', async () => {
    const responses = await Promise.all([
      signIn(userEndpoint, devAdminEmail), signIn(adminEndpoint, devAdminEmail),
      signIn(adminEndpoint, devCeoEmail), signIn(userEndpoint, devCeoEmail),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([401, 200, 401, 200]);
  });
  it('menolak password salah, akun tidak ada, asal berbeda, dan signup publik', async () => {
    for (const url of [adminEndpoint, userEndpoint]) {
      expect((await signIn(url, devAdminEmail, { password: 'wrong-password' })).statusCode).toBe(401);
      expect((await signIn(url, 'absent@ruangkerja.test')).statusCode).toBe(401);
      expect((await signIn(url, devAdminEmail, {}, { origin: 'https://foreign.example' })).statusCode).toBe(403);
    }
    expect((await signIn('/api/auth/sign-up/email', devAdminEmail)).statusCode).toBe(404);
    expect((await signIn('/api/superadmin/auth/sign-up/email', devAdminEmail)).statusCode).toBe(404);
  });
  it('pembaruan sesi melalui pergantian password Superadmin tetap memerlukan sesi sah', async () => {
    const headers = await fixture.login(devAdminEmail);
    const next = `QA-Admin-${randomUUID()}`;
    const changed = await fixture.app.inject({ method: 'POST', url: '/api/account/password', headers,
      payload: { currentPassword: process.env.SEED_PASSWORD, newPassword: next } });
    expect(changed.statusCode).toBe(200);
    expect((await fixture.app.inject({ url: '/api/session', headers })).statusCode).toBe(401);
    const renewed = { ...headers, cookie: changed.cookies.map(({ name, value }) => `${name}=${value}`).join('; ') };
    expect((await fixture.app.inject({ url: '/api/session', headers: renewed })).json()).toMatchObject({ user: { role: 'superadmin' } });
    const reset = await fixture.app.inject({ method: 'POST', url: '/api/account/password', headers: renewed,
      payload: { currentPassword: next, newPassword: process.env.SEED_PASSWORD } });
    expect(reset.statusCode).toBe(200);
  });
  it('akun Superadmin yang dicabut tetap ditolak pada portal khusus', async () => {
    await fixture.db.query("UPDATE account_access SET state='revoked' WHERE user_id=(SELECT id FROM \"user\" WHERE email=$1)", [devAdminEmail]);
    const before = await sessionCount();
    const response = await signIn(adminEndpoint, devAdminEmail);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(await sessionCount()).toBe(before);
  });
});
