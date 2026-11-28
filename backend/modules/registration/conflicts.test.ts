import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prepareAdminFixture } from '../../tests/admin-fixture.js';

describe('registration draft conflicts across browsers', () => {
  let fixture: Awaited<ReturnType<typeof prepareAdminFixture>>;
  const mails: { email: string; verificationUrl: string }[] = [];
  let divisionId: string;
  const password = 'Draft-' + randomUUID();
  beforeAll(async () => {
    fixture = await prepareAdminFixture({ sendRegistration: async (mail) => { mails.push(mail); } });
    divisionId = (await fixture.db.query("SELECT id FROM divisions WHERE status='active' LIMIT 1")).rows[0].id;
  }, 30000);
  afterAll(async () => { await fixture?.close(); });
  const save = (email: string, originDevice = 'mobile', cookie?: string, name = 'Anggota Draft', secret = password) =>
    fixture.app.inject({ method: 'POST', url: '/api/registration', headers: cookie ? { cookie } : {},
      payload: { name, email, divisionId, password: secret, originDevice } });
  const cookieOf = (response: { headers: Record<string, unknown> }) => String(response.headers['set-cookie']).split(';')[0];
  const send = async (cookie: string) => {
    const response = await fixture.app.inject({ method: 'POST', url: '/api/registration/send-email', headers: { cookie }, payload: {} });
    expect(response.statusCode).toBe(200);
    return new URLSearchParams(new URL(mails.at(-1)!.verificationUrl).hash.slice(1)).get('token')!;
  };
  const verify = (token: string, cookie?: string) => fixture.app.inject({ method: 'POST', url: '/api/registration/verify',
    headers: cookie ? { cookie } : {}, payload: { token } });

  it('allows a fresh browser to register without inheriting or overwriting another browser draft', async () => {
    const email = 'separate.browser@egiresources.com';
    const first = await save(email, 'desktop');
    const second = await save(email, 'mobile', undefined, 'Anggota Browser Baru', password + '-second');
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(cookieOf(first)).not.toBe(cookieOf(second));
    expect(second.json().registration).toMatchObject({ origin_device: 'mobile', name: 'Anggota Browser Baru', delivery: 'not_sent' });
    const original = await fixture.app.inject({ url: '/api/registration/status', headers: { cookie: cookieOf(first) } });
    expect(original.json().registration).toMatchObject({ origin_device: 'desktop', name: 'Anggota Draft' });
    expect(mails).toHaveLength(0);
    const token = await send(cookieOf(second));
    expect((await verify(token, cookieOf(second))).json()).toMatchObject({ origin_device: 'mobile', same_browser: true });
    await fixture.app.inject({ method: 'POST', url: '/api/registration/progress', headers: { cookie: cookieOf(second) }, payload: { step: 'iphone-open' } });
    expect((await fixture.app.inject({ method: 'POST', url: '/api/registration/complete', headers: { cookie: cookieOf(second) }, payload: { method: 'iphone-confirmed' } })).statusCode).toBe(200);
    expect((await fixture.app.inject({ url: '/api/registration/status', headers: { cookie: cookieOf(first) } })).json()).toEqual({ registration: null });
  });

  it('accepts immediate owner edits but preserves the resend cooldown and invalidates the previous link', async () => {
    const email = 'edit.during.cooldown@egiresources.com';
    const cookie = cookieOf(await save(email));
    const token = await send(cookie);
    const edited = await save(email, 'desktop', cookie, 'Anggota Setelah Edit');
    expect(edited.statusCode).toBe(201);
    expect(edited.json().registration).toMatchObject({ name: 'Anggota Setelah Edit', origin_device: 'mobile', delivery: 'not_sent', sends_remaining: 4 });
    expect(edited.json().registration.retry_after_seconds).toBeGreaterThan(0);
    expect((await verify(token)).statusCode).toBe(400);
    expect((await fixture.app.inject({ method: 'POST', url: '/api/registration/send-email', headers: { cookie }, payload: {} })).statusCode).toBe(429);
  });

  it('activates only the verified draft and cannot activate a second account through a concurrent link', async () => {
    const email = 'concurrent.drafts@egiresources.com';
    const first = cookieOf(await save(email, 'desktop'));
    const second = cookieOf(await save(email, 'desktop', undefined, 'Anggota Draft Dua', password+'-second'));
    const tokens = [await send(first), await send(second)];
    const responses = await Promise.all(tokens.map((token) => verify(token)));
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 400]);
    const winner = responses.findIndex((response) => response.statusCode === 200);
    expect(responses[winner].json()).toMatchObject({ origin_device: 'desktop', same_browser: false });
    expect((await fixture.db.query('SELECT FROM "user" WHERE email=$1', [email])).rowCount).toBe(1);
    expect((await fixture.db.query('SELECT FROM app_private.member_registrations WHERE email=$1 AND (credential_hash IS NOT NULL OR token_hash IS NOT NULL)', [email])).rowCount).toBe(0);
    expect((await save(email)).json().message).toContain('sudah memiliki akun');
    const identity = await fixture.login(email, winner === 0 ? password : password+'-second');
    expect((await fixture.app.inject({ url: '/api/session', headers: identity })).json().user.role).toBe('member');
  },15000);
});
