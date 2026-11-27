import { betterAuth } from 'better-auth';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { inTransaction } from '../../db/transaction.js';
import { ApiError } from '../../http/api-error.js';
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
            if (!identity) return false;
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

export function registerAuthRoutes(app: FastifyInstance, auth: Auth, origin: string) {
  app.route({
    method: 'POST',
    url: '/api/auth/*',
    async handler(request, reply) {
      const url = new URL(request.url, origin);
      if (url.pathname !== '/api/auth/sign-in/email' && url.pathname !== '/api/auth/sign-out') {
        throw new ApiError(404, 'Halaman tidak ditemukan.');
      }
      const headers = fromNodeHeaders(request.headers);
      headers.delete('content-length');
      const response = await auth.handler(new Request(url, {
        method: request.method,
        headers,
        body: request.body == null ? undefined : JSON.stringify(request.body),
      }));

      for (const [name, value] of response.headers) {
        if (name !== 'set-cookie') reply.header(name, value);
      }
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header('set-cookie', cookies);
      return reply
        .code(response.status)
        .send(response.body && Buffer.from(await response.arrayBuffer()));
    },
  });
}
