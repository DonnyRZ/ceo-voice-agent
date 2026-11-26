import { Pool } from 'pg';
import { z } from 'zod';
import { devAdminEmail, ensureAdminAccount } from './admin-account.js';

const development = process.env.NODE_ENV !== 'production';
const configured = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
const email = z.email().safeParse(configured);
const password = process.env.SUPERADMIN_PASSWORD ||
  (development && email.data === devAdminEmail ? process.env.SEED_PASSWORD : undefined);
const database = process.env.DATABASE_ADMIN_URL;

if (!email.success || !database || !password || password.length < 12 || password.length > 128) {
  throw new Error('Siapkan DATABASE_ADMIN_URL, SUPERADMIN_EMAIL, dan SUPERADMIN_PASSWORD sepanjang 12–128 karakter.');
}

const pool = new Pool({ connectionString: database, connectionTimeoutMillis: 5_000 });
try {
  const created = await ensureAdminAccount(pool, email.data, password);
  console.log(created ? 'Akun Superadmin siap.' : 'Akun Superadmin sudah ada.');
} finally {
  await pool.end();
}
