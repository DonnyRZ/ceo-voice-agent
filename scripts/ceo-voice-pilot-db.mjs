import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { Pool } from 'pg';

const run = promisify(execFile);

function databaseUrl(source, name) {
  const url = new URL(source);
  url.pathname = `/${name}`;
  return url.href;
}

export async function openPilotDb(environment, insertFixtures) {
  if (!environment.DATABASE_ADMIN_URL || !environment.DATABASE_URL || !environment.SEED_PASSWORD) {
    throw new Error('Siapkan PostgreSQL dan SEED_PASSWORD untuk pilot.');
  }
  const name = `rk_voice_pilot_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: environment.DATABASE_ADMIN_URL, connectionTimeoutMillis: 5_000 });
  const isolated = {
    ...environment,
    DATABASE_ADMIN_URL: databaseUrl(environment.DATABASE_ADMIN_URL, name),
    DATABASE_URL: databaseUrl(environment.DATABASE_URL, name),
  };
  let created = false;
  let db;
  async function close() {
    try {
      await db?.end();
      if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    const childEnv = { ...isolated, NODE_ENV: 'development', AI_VOICE_ENABLED: 'false' };
    delete childEnv.OPENAI_API_KEY;
    for (const task of ['migrate', 'seed']) {
      try {
        await run(process.execPath, ['--import', 'tsx', `backend/db/${task}.ts`], { env: childEnv, timeout: 25_000 });
      } catch {
        throw new Error(`Database sintetis gagal pada tahap ${task}.`);
      }
    }
    db = new Pool({ connectionString: isolated.DATABASE_ADMIN_URL, connectionTimeoutMillis: 5_000 });
    await insertFixtures(db);
    return { db, environment: isolated, close };
  } catch (error) {
    await close();
    throw error;
  }
}
