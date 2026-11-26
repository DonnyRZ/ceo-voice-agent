import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { Pool } from 'pg';
import type { AppConfig } from './config.js';
import { ApiError, installErrorHandler } from './http/api-error.js';
import { createAuth, registerAuthRoutes } from './modules/auth/auth.js';
import { memberAccess } from './modules/auth/member-access.js';
import { registerDivisionRoutes } from './modules/divisions/routes.js';
import { registerProjectRoutes } from './modules/projects/routes.js';
import { registerTaskRoutes } from './modules/timesheets/routes.js';

type Options = {
  log?: boolean;
  serveFrontend?: boolean;
};

export async function createApp(config: AppConfig, options: Options = {}) {
  const app = Fastify({
    logger: options.log ? { redact: ['req.headers.cookie', 'req.headers.authorization'] } : false,
    bodyLimit: 64 * 1024,
  });
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    connectionTimeoutMillis: 5_000,
  });
  pool.on('error', (err) => app.log.error({ err }, 'Koneksi database terputus'));
  app.addHook('onClose', () => pool.end());
  installErrorHandler(app);

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    reply.header('cache-control', 'no-store');

    const origin = request.headers.origin;
    if (request.method !== 'GET' && request.method !== 'HEAD' && origin && origin !== config.APP_ORIGIN) {
      throw new ApiError(403, 'Asal permintaan tidak diizinkan.');
    }
  });

  const auth = createAuth(pool, config.APP_ORIGIN, config.BETTER_AUTH_SECRET);
  const requireMember = memberAccess(pool, auth);
  registerAuthRoutes(app, auth, config.APP_ORIGIN);
  registerDivisionRoutes(app, requireMember);
  registerProjectRoutes(app, requireMember);
  registerTaskRoutes(app, requireMember);

  app.get('/api/health', async () => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      throw new ApiError(503, 'Database belum siap.');
    }
  });

  if (options.serveFrontend) {
    await app.register(fastifyStatic, {
      root: fileURLToPath(new URL('../frontend/dist/', import.meta.url)),
      wildcard: false,
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0];
    if (options.serveFrontend && request.method === 'GET' &&
        path !== '/api' && !path.startsWith('/api/') && !path.split('/').pop()?.includes('.')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ message: 'Halaman tidak ditemukan.' });
  });
  return app;
}
