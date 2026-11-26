import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import type { Pool } from 'pg';
import { inTransaction } from './transaction.js';

export const devAdminEmail = 'superadmin@ruangkerja.test';

export async function ensureAdminAccount(pool: Pool, email: string, password: string) {
  const credential = await hashPassword(password);
  return inTransaction(pool, async (db) => {
    await db.query('SELECT pg_catalog.pg_advisory_xact_lock(20261126, 1)');
    const { rows: [user] } = await db.query<{ id: string }>(`
      INSERT INTO "user" (id, name, email, "emailVerified")
      VALUES ($1, 'Superadmin', $2, true) ON CONFLICT (email) DO NOTHING RETURNING id
    `, [randomUUID(), email]);
    if (!user) {
      const existing = await db.query(`
        SELECT 1 FROM account_access access JOIN "user" profile ON profile.id = access.user_id
        WHERE profile.email = $1 AND access.role = 'superadmin' AND access.state = 'active'
      `, [email]);
      if (existing.rowCount !== 1) throw new Error('Email sudah memiliki akun. Pilih email Superadmin lain.');
      return false;
    }

    await db.query(`
      INSERT INTO account (id, "accountId", "providerId", "userId", password)
      VALUES ($1, $2, 'credential', $2, $3)
    `, [randomUUID(), user.id, credential]);
    await db.query("INSERT INTO account_access (user_id, role) VALUES ($1, 'superadmin')", [user.id]);
    return true;
  });
}
