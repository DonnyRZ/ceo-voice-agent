import { Pool } from 'pg';
import { readConfig } from '../config.js';
import { createAuth } from '../modules/auth/auth.js';
import { divisions, firstTaskId, it, projects, seededTaskId, tasks, users } from './seed-data.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error('Data contoh tersedia untuk pengembangan.');
}
const database = process.env.DATABASE_ADMIN_URL;
const password = process.env.SEED_PASSWORD;
if (!database || !password || password.length < 12 || password.length > 128) {
  throw new Error('Siapkan DATABASE_ADMIN_URL dan SEED_PASSWORD sepanjang 12–128 karakter.');
}
const config = readConfig();
const pool = new Pool({ connectionString: database, connectionTimeoutMillis: 5_000 });
const auth = createAuth(pool, config.APP_ORIGIN, config.BETTER_AUTH_SECRET, true);

try {
  const accounts = [];
  for (const user of users) {
    const { rows: [existing] } = await pool.query<{ id: string }>(
      'SELECT id FROM "user" WHERE email = $1',
      [user.email],
    );
    const account = existing ?? (await auth.api.signUpEmail({
      body: { email: user.email, password, name: user.name },
    })).user;
    accounts.push({ ...user, id: account.id });
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    for (const division of divisions) {
      await db.query('INSERT INTO divisions (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', division);
    }
    for (const { id, divisionId, name } of accounts) {
      await db.query(`
        INSERT INTO members (id, division_id, name) VALUES ($1, $2, $3)
        ON CONFLICT (id) DO NOTHING
      `, [id, divisionId, name]);
    }
    for (const project of projects) {
      await db.query(`
        INSERT INTO projects (id, division_id, name, description, status)
        VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING
      `, project);
    }

    for (const [index, divisionId, date, title, description, projectId, status] of tasks) {
      const name = divisionId === it ? (index === 2 || index % 3 === 0 ? 'Hakim' : 'Doni') : 'Laura';
      const pic = accounts.find((account) => account.name === name);
      if (!pic) throw new Error('PIC data contoh tidak ditemukan.');
      await db.query("SELECT set_config('app.user_id', $1, true)", [pic.id]);
      const id = seededTaskId(index);
      const inserted = await db.query(`
        INSERT INTO tasks (id, division_id, date, title, description, project_id, pic_id, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING
      `, [id, divisionId, date, title, description, projectId, pic.id, status]);
      if (id === firstTaskId && inserted.rowCount === 1) {
        await db.query(`
          UPDATE tasks SET status = 'on_progress', version = version + 1, updated_at = now()
          WHERE id = $1
        `, [id]);
      }
    }
    await db.query('COMMIT');
    console.log('Data contoh divisi IT dan Finance siap.');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
} finally {
  await pool.end();
}
