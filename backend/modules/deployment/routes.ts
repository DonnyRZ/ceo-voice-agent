import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../../http/api-error.js';
import type { VoiceApi } from '../ai/routes.js';

export function registerDeploymentRoutes(app: FastifyInstance, service?: Pick<VoiceApi, 'beginDrain' | 'resume'>, token = process.env.DEPLOY_CONTROL_TOKEN) {
  const expected = token && token.length >= 32 ? Buffer.from(token) : undefined;
  const authenticate = (header: unknown) => {
    const supplied = typeof header === 'string' ? Buffer.from(header) : Buffer.alloc(0);
    if (!expected || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ApiError(404, 'Halaman tidak ditemukan.');
    }
  };
  app.post('/internal/deployment/drain', async (request, reply) => {
    authenticate(request.headers['x-deploy-token']);
    reply.header('cache-control', 'no-store');
    return { activeVoiceSessions: service?.beginDrain?.() ?? 0 };
  });
  app.post('/internal/deployment/resume', async (request, reply) => {
    authenticate(request.headers['x-deploy-token']);
    service?.resume?.();
    return reply.code(204).send();
  });
}
