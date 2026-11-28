import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { expect } from 'vitest';
import { createApp } from '../app.js';
import { readConfig } from '../config.js';

type AppOptions = NonNullable<Parameters<typeof createApp>[1]>;
const run = promisify(execFile);

function withDatabase(source: string, database: string) {
  const url = new URL(source);
  url.pathname = `/${database}`;
  return url.href;
}

async function dropDatabase(pool: Pool, database: string) {
  const waits = [80, 200, 400];
  for (let attempt = 0; ; attempt++) {
    try {
      await pool.query(`DROP DATABASE "${database}"`);
      return;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== '55006' || attempt === waits.length) {
        throw new Error(`Basis data pengujian belum dapat dihapus (${code ?? 'tanpa kode SQL'}).`);
      }
      await delay(waits[attempt]);
    }
  }
}

export async function prepareAdminFixture(options: AppOptions = {}) {
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL ?? process.env.DATABASE_ADMIN_URL;
  const runtimeUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  const password = process.env.SEED_PASSWORD;
  if (!adminUrl || !runtimeUrl || !password) {
    throw new Error('Siapkan PostgreSQL lokal dan SEED_PASSWORD sebelum pengujian Superadmin.');
  }

  // Every run owns its database so existing seed data and parallel suites are isolated.
  const database = `rk_admin_${randomUUID().replaceAll('-', '')}`;
  const sessionPool = new Pool({ connectionString: adminUrl, connectionTimeoutMillis: 5_000 });
  const environment = {
    ...process.env,
    DATABASE_URL: withDatabase(runtimeUrl, database),
    DATABASE_ADMIN_URL: withDatabase(adminUrl, database),
  };
  const config = readConfig(environment);

  let created = false;
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  let db: Pool | undefined;
  async function close() {
    try {
      const closed = await Promise.allSettled([app?.close(), db?.end()]);
      if (closed.some(({ status }) => status === 'rejected')) {
        throw new Error('Koneksi basis data pengujian belum dapat ditutup.');
      }
      if (created) await dropDatabase(sessionPool, database);
    } finally {
      await sessionPool.end();
    }
  }

  try {
    await sessionPool.query(`CREATE DATABASE "${database}"`);
    created = true;
    for (const script of ['migrate', 'seed']) {
      await run(process.execPath, ['--import', 'tsx', `backend/db/${script}.ts`], {
        env: environment,
        timeout: 20_000,
      });
    }
    app = await createApp(config, options);
    db = new Pool({ connectionString: environment.DATABASE_ADMIN_URL, connectionTimeoutMillis: 5_000 });
    const service = app;
    const databaseClient = db;
    async function login(email: string, secret = password) {
      const { rows: [identity] } = await databaseClient.query<{ role: string }>(
        'SELECT access.role FROM account_access access JOIN "user" profile ON profile.id = access.user_id WHERE lower(profile.email) = lower($1)', [email],
      );
      const response = await service.inject({
        method: 'POST',
        url: identity?.role === 'superadmin' ? '/api/superadmin/auth/sign-in/email' : '/api/auth/sign-in/email',
        headers: { origin: config.APP_ORIGIN },
        payload: { email, password: secret },
      });
      expect(response.statusCode).toBe(200);
      const header = response.headers['set-cookie'];
      const cookies = Array.isArray(header) ? header : [header ?? ''];
      expect(cookies.some((cookie) => /; httponly/i.test(cookie))).toBe(true);
      return { cookie: cookies.map((cookie) => cookie.split(';')[0]).join('; '), origin: config.APP_ORIGIN };
    }
    return { app: service, db, config, login, close };
  } catch (error) {
    await close();
    throw error;
  }
}
