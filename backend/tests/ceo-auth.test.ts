import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { devAdminEmail } from '../db/admin-account.js';
import { it } from '../db/seed-data.js';
import { prepareAdminFixture } from './admin-fixture.js';

test('Superadmin dapat mengundang dan mencabut akses CEO lintas divisi', async () => {
  const email = `ceo-${randomUUID()}@ruangkerja.test`;
  let link: URL | undefined;
  const fixture = await prepareAdminFixture({
    sendInvitation: async ({ email: recipient, activationUrl }) => {
      expect(recipient).toBe(email);
      link = new URL(activationUrl);
    },
  });

  try {
    const { app, db, login } = fixture;
    const admin = await login(devAdminEmail);
    const invitation = { email, role: 'ceo' };
    const invalid = await app.inject({
      method: 'POST', url: '/api/admin/invitations', headers: admin, payload: { ...invitation, divisionId: it },
    });
    expect(invalid.statusCode).toBe(400);

    const invited = await app.inject({ method: 'POST', url: '/api/admin/invitations', headers: admin, payload: invitation });
    expect(invited.statusCode).toBe(201);
    expect(invited.json()).toMatchObject({ role: 'ceo', divisionId: null });
    const token = new URLSearchParams(link?.hash.slice(1)).get('token');
    expect(token).toBeTruthy();
    const password = `QA-Aktivasi-${randomUUID()}`;
    const activated = await app.inject({
      method: 'POST', url: '/api/activate', payload: { token, name: 'CEO Undangan QA', password },
    });
    expect(activated.statusCode).toBe(201);

    const headers = await login(email, password);
    const session = await app.inject({ url: '/api/session', headers });
    expect(session.statusCode).toBe(200);
    const { user } = session.json<{ user: { id: string } }>();
    expect(user).toMatchObject({ role: 'ceo', divisionId: null, divisionName: null });
    const memberships = await db.query('SELECT id FROM members WHERE id = $1', [user.id]);
    expect(memberships.rows).toEqual([]);

    for (const url of ['/api/projects', '/api/members', '/api/admin/dashboard', '/api/admin/audit', '/api/admin/users']) {
      expect((await app.inject({ url, headers })).statusCode, url).toBe(403);
    }
    const revoked = await app.inject({ method: 'DELETE', url: `/api/admin/users/${user.id}`, headers: admin });
    expect(revoked.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/session', headers })).statusCode).toBe(401);
  } finally {
    await fixture.close();
  }
}, 45_000);
