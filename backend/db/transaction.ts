import type { Pool, PoolClient } from 'pg';

export async function inTransaction<T>(pool: Pool, run: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  let releaseError: Error | undefined;
  try {
    await db.query('BEGIN');
    const value = await run(db);
    await db.query('COMMIT');
    return value;
  } catch (error) {
    try {
      await db.query('ROLLBACK');
    } catch (rollbackError) {
      releaseError = rollbackError instanceof Error ? rollbackError : new Error('Rollback gagal.');
    }
    throw error;
  } finally {
    db.release(releaseError);
  }
}
