import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareAdminFixture } from '../../tests/admin-fixture.js';

describe('verified company member registration', () => {
  let fixture: Awaited<ReturnType<typeof prepareAdminFixture>>;
  const sent: { email: string; verificationUrl: string }[] = [];
  let divisionId: string;
  let failure = false;
  const password = 'Testing-member-8364';
  const claims = new Map<string, string>();
  const headers = () => ({ origin: fixture.config.APP_ORIGIN });
  const input = (email: string) => ({ name: 'Anggota Baru', email, divisionId, password, originDevice: 'desktop' });
  const post = async (email: string) => {
    const response = await fixture.app.inject({ method: 'POST', url: '/api/registration', headers: headers(), payload: input(email) });
    if (response.statusCode === 201) claims.set(email, String(response.headers['set-cookie']).split(';')[0]);
    return response;
  };
  const send = (email: string) => fixture.app.inject({ method: 'POST', url: '/api/registration/send-email', headers: { ...headers(), cookie: claims.get(email)! }, payload: {} });
  const tokenFor = (email: string) => new URLSearchParams(new URL(sent.findLast((mail) => mail.email === email)!.verificationUrl).hash.slice(1)).get('token')!;
  const verify = (token: string) => fixture.app.inject({ method: 'POST', url: '/api/registration/verify', headers: headers(), payload: { token } });
  beforeAll(async () => {
    fixture = await prepareAdminFixture({ sendRegistration: async (mail) => { if (failure) throw new Error('SMTP unavailable'); sent.push(mail); } });
    divisionId = (await fixture.db.query("SELECT id FROM divisions WHERE status = 'active' LIMIT 1")).rows[0].id;
  }, 30000);
  afterAll(async () => { await fixture?.close(); });

  it('publishes only active division labels and allowed email domains', async () => {
    const result = await fixture.app.inject('/api/registration/divisions');
    expect(result.statusCode).toBe(200);
    expect(result.json().emailDomains).toEqual(['egiresources.com']);
    expect(Object.keys(result.json().divisions[0]).sort()).toEqual(['id', 'name']);
  });

  it('desktop creates no account until email verification, then activates the selected division and Better Auth login', async () => {
    const email = 'new.member@egiresources.com';
    const response = await post(email);
    expect(response.statusCode).toBe(201);
    expect(response.json().registration).toMatchObject({ delivery: 'not_sent', origin_device: 'desktop', verified: false });
    expect(sent).toHaveLength(0);
    const cookie = String(response.headers['set-cookie']).split(';')[0];
    expect(response.headers['set-cookie']).toMatch(/HttpOnly; SameSite=Strict/);
    expect((await fixture.db.query('SELECT FROM "user" WHERE email=$1', [email])).rowCount).toBe(0);
    const before = await fixture.app.inject({ url: '/api/registration/status', headers: { cookie } });
    expect(before.json().registration).toMatchObject({ email, verified: false, division_id: divisionId });
    expect((await send(email)).json().delivery).toBe('sent');
    const token = tokenFor(email);
    const stored = (await fixture.db.query('SELECT * FROM app_private.member_registrations WHERE email=$1', [email])).rows[0];
    expect(stored.credential_hash).not.toContain(password);
    expect(stored.token_hash).not.toBe(token);
    expect(await verify(token)).toMatchObject({ statusCode: 200 });
    expect((await fixture.app.inject({ url: '/api/registration/status', headers: { cookie } })).json().registration.verified).toBe(true);
    expect((await verify(token)).statusCode).toBe(400);
    const { rows: [account] } = await fixture.db.query('SELECT access.*, profile."emailVerified" FROM account_access access JOIN "user" profile ON profile.id=access.user_id WHERE profile.email=$1', [email]);
    expect(account).toMatchObject({ role: 'member', division_id: divisionId, state: 'active', emailVerified: true });
    const identity = await fixture.login(email, password);
    expect((await fixture.app.inject({ url: '/api/session', headers: identity })).json().user.role).toBe('member');
    expect((await fixture.app.inject({ url: '/api/admin/users', headers: identity })).statusCode).toBe(403);
    expect((await fixture.app.inject({ url: '/api/ceo/dashboard', headers: identity })).statusCode).toBe(403);
    const consumed = (await fixture.db.query('SELECT credential_hash, token_hash FROM app_private.member_registrations WHERE email=$1', [email])).rows[0];
    expect(consumed).toEqual({ credential_hash: null, token_hash: null });
    expect((await fixture.db.query("SELECT FROM audit_log WHERE record_table='account_access' AND record_id=$1", [account.user_id])).rowCount).toBeGreaterThan(0);
  });

  it('rejects role escalation, cross-origin requests, malformed input and lookalike domains', async () => {
    for (const email of ['name@gmail.com', 'name@sub.egiresources.com', 'name@egiresources.com.evil.test']) {
      expect((await post(email)).statusCode).toBe(400);
    }
    expect((await fixture.app.inject({ method: 'POST', url: '/api/registration', headers: headers(), payload: { ...input('role@egiresources.com'), role: 'superadmin' } })).statusCode).toBe(400);
    expect((await fixture.app.inject({ method: 'POST', url: '/api/registration', headers: { origin: 'https://evil.test' }, payload: input('csrf@egiresources.com') })).statusCode).toBe(403);
    expect((await fixture.app.inject({ method: 'POST', url: '/api/registration', payload: { ...input('short@egiresources.com'), password: '123' } })).statusCode).toBe(400);
    expect((await fixture.app.inject({ method: 'POST', url: '/api/auth/sign-up/email', payload: input('bypass@egiresources.com') })).statusCode).toBe(404);
  });

  it('keeps failed email deliveries pending and supports bounded owner-only resend with old-token invalidation', async () => {
    const email = 'retry@egiresources.com';
    failure = true;
    const response = await post(email);
    const failed = await send(email);
    failure = false;
    expect(response.statusCode).toBe(201);
    expect(failed.json().delivery).toBe('failed');
    const cookie = String(response.headers['set-cookie']).split(';')[0];
    expect((await fixture.app.inject({ method: 'POST', url: '/api/registration/send-email', payload: {} })).statusCode).toBe(400);
    expect((await send(email)).statusCode).toBe(429);
    const oldHash = (await fixture.db.query('SELECT token_hash FROM app_private.member_registrations WHERE email=$1', [email])).rows[0].token_hash;
    await fixture.db.query("UPDATE app_private.member_registrations SET sent_at=now()-interval '61 seconds' WHERE email=$1", [email]);
    expect((await send(email)).json().delivery).toBe('sent');
    expect((await fixture.db.query('SELECT token_hash FROM app_private.member_registrations WHERE email=$1', [email])).rows[0].token_hash).not.toBe(oldHash);
    expect((await verify(tokenFor(email))).statusCode).toBe(200);
  });

  it('does not expose pending data or permit replay/concurrent double activation', async () => {
    expect((await fixture.app.inject('/api/registration/status')).json()).toEqual({ registration: null });
    const email = 'parallel@egiresources.com';
    await post(email);
    await send(email);
    expect((await post(email)).statusCode).toBe(201);
    const token = tokenFor(email);
    const responses = await Promise.all([verify(token), verify(token)]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 400]);
    expect((await fixture.db.query('SELECT FROM "user" WHERE email=$1', [email])).rowCount).toBe(1);
  });

  it('rejects expired tokens and invalid or archived divisions', async () => {
    const email = 'expired@egiresources.com';
    await post(email);
    await send(email);
    await fixture.db.query("UPDATE app_private.member_registrations SET expires_at=now()-interval '1 second' WHERE email=$1", [email]);
    expect((await verify(tokenFor(email))).statusCode).toBe(400);
    expect((await fixture.app.inject({ method: 'POST', url: '/api/registration', payload: { ...input('missing@egiresources.com'), divisionId: '00000000-0000-4000-8000-000000000000' } })).statusCode).toBe(409);
  });


  it('normalizes company addresses and throttles repeated registration attempts persistently', async () => {
    const uppercase = 'CASE.Member@EGIRESOURCES.COM';
    expect((await post(uppercase)).statusCode).toBe(201);
    await send(uppercase);
    expect(sent.findLast((mail) => mail.email === uppercase.toLowerCase())).toBeDefined();
    const email = 'limited@egiresources.com';
    expect((await post(email)).statusCode).toBe(201);
    for (let count = 0; count < 4; count++) expect((await post(email)).statusCode).toBe(201);
    expect((await post(email)).statusCode).toBe(429);
  });

  it('rechecks a division at verification and respects an email reserved by an invitation', async () => {
    const { rows: [division] } = await fixture.db.query("INSERT INTO divisions(name) VALUES ('Registrasi QA sementara') RETURNING id");
    const email = 'archived.division@egiresources.com';
    const response = await fixture.app.inject({ method: 'POST', url: '/api/registration', payload: { ...input(email), divisionId: division.id } });
    expect(response.statusCode).toBe(201);
    claims.set(email, String(response.headers['set-cookie']).split(';')[0]);
    await send(email);
    await fixture.db.query("UPDATE divisions SET status='archived' WHERE id=$1", [division.id]);
    expect((await verify(tokenFor(email))).statusCode).toBe(400);
    expect((await fixture.db.query('SELECT FROM "user" WHERE email=$1', [email])).rowCount).toBe(0);
    await fixture.db.query("INSERT INTO invitations(email,role,token_hash,expires_at) VALUES ('reserved@egiresources.com','ceo',repeat('e',64),now()+interval '1 day')");
    expect((await post('reserved@egiresources.com')).statusCode).toBe(409);
  });

  it('serves an installable self-scoped manifest without caching or environment mixing', async () => {
    const response = await fixture.app.inject('/manifest.webmanifest');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/manifest+json');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({ id: '/', scope: '/', start_url: '/launch?source=installed', display: 'standalone' });
    expect(response.json().icons.map((icon: {sizes: string}) => icon.sizes)).toEqual(['192x192','512x512']);
    expect(response.json().related_applications[0].url).toBe(fixture.config.APP_ORIGIN+'/manifest.webmanifest');
  });

  it('runtime SQL cannot read pending passwords/tokens or mint elevated roles', async () => {
    const pool = new Pool({ connectionString: fixture.config.DATABASE_URL });
    try {
      await expect(pool.query('SELECT * FROM app_private.member_registrations')).rejects.toThrow(/permission denied/);
      const { rows: [permission] } = await fixture.db.query("SELECT has_function_privilege('public', 'public.verify_member_registration(text,text,text)', 'EXECUTE') permitted");
      expect(permission.permitted).toBe(false);
    } finally { await pool.end(); }
  });
});
