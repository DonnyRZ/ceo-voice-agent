import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { Pool } from 'pg';
import type { AppConfig } from './config.js';
import { ApiError, installErrorHandler } from './http/api-error.js';
import { registerAccountRoutes } from './modules/account/routes.js';
import { adminAccess } from './modules/admin/access.js';
import { registerCeoVoiceRoutes, type VoiceApi } from './modules/ai/routes.js';
import { createVoiceRuntime, type VoiceAudit } from './modules/ai/voice-runtime.js';
import { registerAuditAdminRoutes } from './modules/admin/audit/routes.js';
import { registerDivisionAdminRoutes } from './modules/admin/divisions/routes.js';
import { registerReportAdminRoutes } from './modules/admin/reports/routes.js';
import { registerActivationRoute } from './modules/admin/users/activation.js';
import { createInvitationMailer, type SendInvitation } from './modules/admin/users/invitation-mailer.js';
import { registerInvitationRoutes, registerUserAdminRoutes } from './modules/admin/users/routes.js';
import { createAuth } from './modules/auth/auth.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { ceoAccess } from './modules/auth/ceo-access.js';
import { memberAccess } from './modules/auth/member-access.js';
import { sessionAccess } from './modules/auth/session-access.js';
import { registerCeoRoutes } from './modules/ceo/routes.js';
import { registerDivisionRoutes } from './modules/divisions/routes.js';
import { registerDeploymentRoutes } from './modules/deployment/routes.js';
import { registerProjectRoutes } from './modules/projects/routes.js';
import { registerTaskRoutes } from './modules/timesheets/routes.js';

type Options = {
  log?: boolean;
  serveFrontend?: boolean;
  sendInvitation?: SendInvitation;
  voice?: VoiceApi;
  voiceAudit?: VoiceAudit;
  databasePoolMax?: number;
  authorizationPoolMax?: number;
};

export async function createApp(config: AppConfig, options: Options = {}) {
  const app = Fastify({
    logger: options.log ? {
      redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-deploy-token"]'],
      serializers: {
        err: (error: Error & { code?: string }) => ({
          type: error.name,
          code: error.code,
          message: 'Kesalahan server.',
          stack: '',
        }),
      },
    } : false,
    bodyLimit: 64 * 1024,
  });
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    connectionTimeoutMillis: 5_000,
    max: options.databasePoolMax ?? 10,
  });
  // Better Auth session hooks run while its adapter may hold a main-pool
  // transaction. This bounded pool performs admission reads only.
  const authorizationPool = new Pool({
    connectionString: config.DATABASE_URL,
    connectionTimeoutMillis: 5_000,
    max: options.authorizationPoolMax ?? 2,
  });
  pool.on('error', (err) => app.log.error({ err }, 'Koneksi database terputus'));
  authorizationPool.on('error', (err) => app.log.error({ err }, 'Koneksi pemeriksaan akses terputus'));
  app.addHook('onClose', async () => { await Promise.all([pool.end(), authorizationPool.end()]); });
  installErrorHandler(app);

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    reply.header('cache-control', 'no-store');

    const origin = request.headers.origin;
    if (request.method !== 'GET' && request.method !== 'HEAD' && origin && origin !== config.APP_ORIGIN) {
      throw new ApiError(403, 'Asal permintaan tidak diizinkan.');
    }
  });

  const auth = createAuth(pool, config.APP_ORIGIN, config.BETTER_AUTH_SECRET, false, authorizationPool);
  const requireSession = sessionAccess(pool, auth);
  const requireMember = memberAccess(requireSession);
  const requireAdmin = adminAccess(requireSession);
  const requireCeo = ceoAccess(requireSession);
  const voice = createVoiceRuntime(pool, app.log, options.voice, options.voiceAudit);
  app.addHook('preClose', voice.close);
  registerDeploymentRoutes(app, voice.service);
  registerAuthRoutes(app, auth, config.APP_ORIGIN);
  app.get('/api/session', (request) => requireSession(request, async ({ actor }) => ({ user: actor })));
  registerAccountRoutes(app, requireSession, auth);
  registerDivisionRoutes(app, requireMember);
  registerProjectRoutes(app, requireMember);
  registerTaskRoutes(app, requireMember);
  registerUserAdminRoutes(app, requireAdmin);
  registerInvitationRoutes(app, requireAdmin, {
    pool,
    origin: config.APP_ORIGIN,
    sendInvitation: options.sendInvitation ?? createInvitationMailer(),
  });
  registerActivationRoute(app, pool);
  registerDivisionAdminRoutes(app, requireAdmin);
  registerReportAdminRoutes(app, requireAdmin);
  registerAuditAdminRoutes(app, requireAdmin);
  registerCeoRoutes(app, requireCeo);
  registerCeoVoiceRoutes(app, { ...voice, requireAdmin, requireCeo });

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
