import { betterAuth } from 'better-auth';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

export function createAuth(pool: Pool, origin: string, secret: string, allowRegistration = false) {
  return betterAuth({
    database: pool,
    baseURL: origin,
    secret,
    trustedOrigins: [origin],
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
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request, reply) {
      const headers = fromNodeHeaders(request.headers);
      headers.delete('content-length');
      const response = await auth.handler(new Request(new URL(request.url, origin), {
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
