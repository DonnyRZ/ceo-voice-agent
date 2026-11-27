import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { installErrorHandler } from '../http/api-error.js';
import { registerDeploymentRoutes } from '../modules/deployment/routes.js';
import { harness, owner } from './voice-service-fixture.js';

const token = 'a'.repeat(64);

describe('deployment draining', () => {
  it('rejects new voice sessions while allowing the active turn to finish', async () => {
    const mock = harness();
    const { input } = await mock.open();
    try {
      expect(mock.service.beginDrain()).toBe(1);
      await expect(mock.service.start({ ...owner, sessionKey: 'new', sdp: 'offer' })).rejects.toMatchObject({ code: 'provider_unavailable' });
      mock.userSpeech('input-1', 'Siapa PIC tugas ini?', 1000, 2000);
      mock.receive({ type: 'delegation', id: 'delegation-1', offsetMs: 2000 });
      await vi.waitFor(() => expect(mock.retrieve).toHaveBeenCalledOnce());
      await mock.service.stop(input);
      expect(mock.service.beginDrain()).toBe(0);
      mock.service.resume();
      await mock.service.start({ ...owner, sdp: 'offer' });
      await mock.service.closeAll();
      mock.service.resume();
      await expect(mock.service.start({ ...owner, sdp: 'offer' })).rejects.toMatchObject({ code: 'provider_unavailable' });
    } finally { await mock.service.closeAll(); }
  });

  it('requires the deployment secret and supports safe abort/resume', async () => {
    const mock = harness();
    const app = Fastify();
    installErrorHandler(app);
    registerDeploymentRoutes(app, mock.service, token);
    try {
      for (const headers of [{}, { 'x-deploy-token': 'wrong' }]) {
        expect((await app.inject({ method: 'POST', url: '/internal/deployment/drain', headers })).statusCode).toBe(404);
      }
      const headers = { 'x-deploy-token': token };
      const response = await app.inject({ method: 'POST', url: '/internal/deployment/drain', headers });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ activeVoiceSessions: 0 });
      expect(response.headers['cache-control']).toBe('no-store');
      expect((await app.inject({ method: 'POST', url: '/internal/deployment/resume', headers })).statusCode).toBe(204);
      await mock.service.start({ ...owner, sdp: 'offer' });
    } finally { await mock.service.closeAll(); await app.close(); }
  });

  it('keeps control endpoints disabled when no usable token is configured', async () => {
    const app = Fastify();
    installErrorHandler(app);
    registerDeploymentRoutes(app, undefined, 'short');
    try {
      expect((await app.inject({ method: 'POST', url: '/internal/deployment/drain', headers: { 'x-deploy-token': 'short' } })).statusCode).toBe(404);
    } finally { await app.close(); }
  });
});
