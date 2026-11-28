import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../../http/api-error.js';
import type { Auth } from './auth.js';
import { loginAdmission, type LoginPortal } from './login-portal.js';

export function registerAuthRoutes(app: FastifyInstance, auth: Auth, origin: string) {
  async function forward(request: FastifyRequest, reply: FastifyReply, path: string, portal?: LoginPortal) {
    const headers = fromNodeHeaders(request.headers);
    headers.delete('content-length');
    const admission = portal ? { portal, denied: false } : undefined;
    const handle = () => auth.handler(new Request(new URL(path, origin), {
      method: 'POST', headers,
      body: request.body == null ? undefined : JSON.stringify(request.body),
    }));
    const response = admission ? await loginAdmission.run(admission, handle) : await handle();
    if (admission?.denied) throw new ApiError(401, 'Email atau kata sandi tidak sesuai.');
    for (const [name, value] of response.headers) {
      if (name !== 'set-cookie') reply.header(name, value);
    }
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) reply.header('set-cookie', cookies);
    return reply.code(response.status).send(response.body && Buffer.from(await response.arrayBuffer()));
  }

  app.post('/api/superadmin/auth/sign-in/email', (request, reply) =>
    forward(request, reply, '/api/auth/sign-in/email', 'superadmin'));

  app.post('/api/auth/*', (request, reply) => {
    const path = new URL(request.url, origin).pathname;
    if (path !== '/api/auth/sign-in/email' && path !== '/api/auth/sign-out') {
      throw new ApiError(404, 'Halaman tidak ditemukan.');
    }
    return forward(request, reply, path, path === '/api/auth/sign-in/email' ? 'user' : undefined);
  });
}
