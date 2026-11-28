import { betterAuth } from 'better-auth';
import type { Pool } from 'pg';
import { inTransaction } from '../../db/transaction.js';
import { admitsLogin } from './login-portal.js';
import { loadIdentity } from './session-access.js';

export function createAuth(
  pool: Pool, origin: string, secret: string, allowRegistration = false, authorizationPool = pool,
) {
  return betterAuth({
    database: pool,
    baseURL: origin,
    secret,
    trustedOrigins: [origin],
    databaseHooks: allowRegistration ? undefined : {
      session: {
        create: {
          before: async ({ userId }) => {
            // Session creation can already hold an adapter transaction. Its admission
            // check must never acquire another connection from that same runtime pool.
            const identity = await inTransaction(authorizationPool, (db) => loadIdentity(db, userId), { readOnly: true });
            if (!identity || !admitsLogin(identity.role)) return false;
          },
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: !allowRegistration,
      autoSignIn: false,
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
