import type { Pool } from 'pg';
import { inTransaction } from '../../../db/transaction.js';
import { loadCeoIdentity } from '../../auth/ceo-access.js';
import type { RetrievalDatabase } from '../retrieval/schema.js';
import type { VoiceOwner } from './types.js';

export function authorizeVoice(pool: Pool, { userId, sessionKey }: VoiceOwner) {
  return inTransaction(pool, async (db) => {
    await db.query("SET LOCAL statement_timeout = '250ms'");
    return !!await loadCeoIdentity(db, userId, sessionKey);
  }, { readOnly: true });
}

export function retrievalDatabase(pool: Pool, owner: VoiceOwner, signal: AbortSignal): RetrievalDatabase {
  function authorizedRead<T>(read: (db: RetrievalDatabase) => Promise<T>, snapshot: boolean) {
    return inTransaction(pool, async (db) => {
      signal.throwIfAborted();
      if (snapshot) await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await db.query("SET LOCAL statement_timeout = '250ms'");
      const actor = await loadCeoIdentity(db, owner.userId, owner.sessionKey);
      if (!actor) throw new Error('Akses CEO berakhir.');
      return read({ query: (sql, parameters) => {
        signal.throwIfAborted();
        return db.query(sql, parameters);
      } });
    }, { readOnly: true });
  }

  return {
    query: (sql, parameters) => authorizedRead((db) => db.query(sql, parameters), false),
    withSnapshot: (read) => authorizedRead(read, true),
  };
}
