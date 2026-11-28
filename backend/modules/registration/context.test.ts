import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareAdminFixture } from '../../tests/admin-fixture.js';

describe('registration origin and explicit verification', () => {
  let fixture: Awaited<ReturnType<typeof prepareAdminFixture>>;
  const mails: { email: string; verificationUrl: string }[] = [];
  let divisionId: string;
  beforeAll(async () => {
    fixture = await prepareAdminFixture({ sendRegistration: async (mail) => { mails.push(mail); } });
    divisionId = (await fixture.db.query("SELECT id FROM divisions WHERE status='active' LIMIT 1")).rows[0].id;
  }, 30000);
  afterAll(async () => { await fixture?.close(); });
  const registration = (originDevice: string, email: string) => fixture.app.inject({ method: 'POST', url: '/api/registration',
    payload: { name: 'Anggota Konteks', email, divisionId, password: 'Registration-test-3987', originDevice } });
  const cookieOf = (response: { headers: Record<string, unknown> }) => String(response.headers['set-cookie']).split(';')[0];
  const tokenOf = (email: string) => new URLSearchParams(new URL(mails.findLast((mail) => mail.email === email)!.verificationUrl).hash.slice(1)).get('token');
  const send = (cookie: string) => fixture.app.inject({ method: 'POST', url: '/api/registration/send-email', headers: { cookie }, payload: {} });
  const verify = (email: string, cookie?: string) => fixture.app.inject({ method: 'POST', url: '/api/registration/verify',
    headers: cookie ? { cookie } : {}, payload: { token: tokenOf(email) } });

  it('does not send email while saving and remembers mobile origin across verification on a different browser', async () => {
    const email = 'mobile.context@egiresources.com';
    const saved = await registration('mobile', email);
    expect(saved.statusCode).toBe(201);
    expect(saved.json().registration).toMatchObject({ origin_device: 'mobile', delivery: 'not_sent', retry_after_seconds: 0 });
    expect(mails).toHaveLength(0);
    const cookie = cookieOf(saved);
    expect((await send(cookie)).json()).toMatchObject({ delivery: 'sent', registration: { retry_after_seconds: 60, sends_remaining: 4 } });
    const confirmed = await verify(email);
    expect(confirmed.json()).toMatchObject({ origin_device: 'mobile', same_browser: false, registration: null });
    const resumed = await fixture.app.inject({ url: '/api/registration/status', headers: { cookie } });
    expect(resumed.json().registration).toMatchObject({ origin_device: 'mobile', verified: true });
    expect((await fixture.app.inject('/api/registration/status')).json()).toEqual({ registration: null });
    expect((await verify(email)).statusCode).toBe(400);
  });

  it('returns verified private progress only to its own original browser and preserves desktop origin', async () => {
    const email = 'desktop.context@egiresources.com';
    const saved = await registration('desktop', email);
    const cookie = cookieOf(saved);
    await send(cookie);
    const response = await verify(email, cookie);
    expect(response.json()).toMatchObject({ origin_device: 'desktop', same_browser: true,
      registration: { email, verified: true, origin_device: 'desktop' } });
  });

  it('does not change a recorded origin after the same browser edits the form or changes its viewport', async () => {
    const email = 'immutable.context@egiresources.com';
    const saved = await registration('mobile', email);
    const cookie = cookieOf(saved);
    const response = await fixture.app.inject({ method: 'POST', url: '/api/registration', headers: { cookie },
      payload: { name: 'Anggota Sesudah Edit', email, divisionId, password: 'Registration-test-3987', originDevice: 'desktop' } });
    expect(response.statusCode).toBe(201);
    expect(response.json().registration.origin_device).toBe('mobile');
    expect(response.json().registration.delivery).toBe('not_sent');
  });

  it('rejects direct use of removed automatic-send endpoints and unrecognized origin values', async () => {
    expect((await fixture.app.inject({ method: 'POST', url: '/api/registration/resend', payload: {} })).statusCode).toBe(404);
    expect((await registration('unknown', 'invalid.origin@egiresources.com')).statusCode).toBe(400);
  });

  it('replaces an edited email atomically, preserves its origin and invalidates the old verification link', async () => {
    const oldEmail = 'before.edit@egiresources.com';
    const newEmail = 'after.edit@egiresources.com';
    const oldCookie = cookieOf(await registration('mobile', oldEmail));
    await send(oldCookie);
    const oldToken = tokenOf(oldEmail);
    const saved = await fixture.app.inject({ method: 'POST', url: '/api/registration', headers: { cookie: oldCookie },
      payload: { name: 'Anggota Edit Email', email: newEmail, divisionId, password: 'Registration-test-3987', originDevice: 'desktop' } });
    expect(saved.statusCode).toBe(201);
    expect(saved.json().registration).toMatchObject({ email: newEmail, origin_device: 'mobile', delivery: 'not_sent' });
    const newCookie = cookieOf(saved);
    expect(newCookie).not.toBe(oldCookie);
    expect((await fixture.app.inject({ url: '/api/registration/status', headers: { cookie: oldCookie } })).json()).toEqual({ registration: null });
    expect((await fixture.app.inject({ method: 'POST', url: '/api/registration/verify', payload: { token: oldToken } })).statusCode).toBe(400);
    await send(newCookie);
    expect((await verify(newEmail, newCookie)).json()).toMatchObject({ origin_device: 'mobile', same_browser: true });
    expect((await fixture.db.query('SELECT FROM "user" WHERE email=$1', [oldEmail])).rowCount).toBe(0);
  });

  it('keeps the original draft and link valid if the replacement email is unavailable', async () => {
    const email = 'rollback.edit@egiresources.com';
    const cookie = cookieOf(await registration('desktop', email));
    await send(cookie);
    const rejected = await fixture.app.inject({ method: 'POST', url: '/api/registration', headers: { cookie },
      payload: { name: 'Anggota Konflik', email: 'desktop.context@egiresources.com', divisionId,
        password: 'Registration-test-3987', originDevice: 'mobile' } });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.headers['set-cookie']).toBeUndefined();
    expect((await fixture.app.inject({ url: '/api/registration/status', headers: { cookie } })).json().registration.email).toBe(email);
    expect((await verify(email, cookie)).statusCode).toBe(200);
  });

  it('does not guess the origin for pre-existing records or reveal another browser progress', async () => {
    const email = 'unrecorded.context@egiresources.com';
    const saved = await registration('mobile', email);
    await fixture.db.query('UPDATE app_private.member_registrations SET origin_device=NULL WHERE email=$1', [email]);
    await send(cookieOf(saved));
    expect((await verify(email, 'rk_registration=' + 'f'.repeat(64))).json()).toMatchObject({ origin_device: null, same_browser: false, registration: null });
  });
});
