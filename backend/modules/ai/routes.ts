import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError, parseInput, resourceId } from '../../http/api-error.js';
import type { RequireAdmin } from '../admin/access.js';
import type { RequireCeo } from '../auth/ceo-access.js';
import type { createVoiceMetrics } from './metrics.js';
import type { CeoFacts } from './retrieval/schema.js';
import { VoiceServiceError } from './voice/service.js';
import type { OwnedVoiceSession, VoiceEvent, VoiceOwner, VoiceTurnKey } from './voice/types.js';

const base = '/api/ceo/voice';
const offer = z.object({ sdp: z.string().min(16).max(55_000).startsWith('v=0') }).strict();
const turnId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/u);
const generation = z.number().int().positive();
const playbackSample = z.strictObject({ elapsedMs: z.number().finite().nonnegative().max(30_000), turnId, generation });
const audioQuery = z.strictObject({ generation: z.coerce.number().pipe(generation) });

export interface VoiceApi {
  start(owner: VoiceOwner & { sdp: string }): Promise<{ id: string; sdp: string }>;
  stop(owner: OwnedVoiceSession): Promise<void>;
  subscribe(owner: OwnedVoiceSession, listener: (event: VoiceEvent<CeoFacts>) => void): () => void;
  takeAudio?(owner: OwnedVoiceSession, turn: VoiceTurnKey): Promise<Buffer | undefined>;
  recordBrowserPlayback?(owner: OwnedVoiceSession, elapsedMs: number, turn?: VoiceTurnKey): boolean;
  closeAll(): Promise<void>;
  beginDrain?(): number;
  resume?(): void;
}

async function voiceCall<T>(run: () => T | Promise<T>) {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof VoiceServiceError)) throw error;
    switch (error.code) {
      case 'unauthorized': throw new ApiError(401, 'Akses sesi sudah berakhir.');
      case 'session_not_found': throw new ApiError(404, 'Sesi suara tidak ditemukan.');
      case 'session_limit': throw new ApiError(429, 'Sesi suara sedang digunakan.');
      default: throw new ApiError(503, 'Sesi suara belum tersedia. Coba lagi nanti.');
    }
  }
}

function openEvents(api: VoiceApi, owner: OwnedVoiceSession, reply: FastifyReply) {
  const queued: VoiceEvent<CeoFacts>[] = [];
  let ready = false;
  let heartbeat: NodeJS.Timeout | undefined;
  function write(event: VoiceEvent<CeoFacts>) {
    if (!ready) {
      queued.push(event);
      return;
    }
    if (reply.raw.destroyed || reply.raw.writableEnded) return;
    const accepted = reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    if (!accepted) reply.raw.destroy();
    if (event.type === 'state' && (event.state === 'closed' || event.state === 'unavailable')) {
      reply.raw.end();
    }
  }
  const unsubscribe = api.subscribe(owner, write);
  reply.raw.once('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    void Promise.resolve().then(() => api.stop(owner)).catch(() => {});
  });
  reply.hijack();
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store, no-transform',
    'x-accel-buffering': 'no',
  });
  reply.raw.flushHeaders();
  ready = true;
  for (const event of queued) write(event);
  heartbeat = setInterval(() => {
    if (!reply.raw.writableEnded && !reply.raw.write(': heartbeat\n\n')) reply.raw.destroy();
  }, 10_000);
  heartbeat.unref();
}

export function registerCeoVoiceRoutes(app: FastifyInstance, options: {
  requireCeo: RequireCeo;
  requireAdmin: RequireAdmin;
  service?: VoiceApi;
  metrics: ReturnType<typeof createVoiceMetrics>;
}) {
  const { requireCeo, requireAdmin, service, metrics } = options;
  const authenticate = (request: FastifyRequest) => requireCeo(request, async ({ actor, sessionId }) => ({
    userId: actor.id,
    sessionKey: sessionId,
  }));
  function available(): VoiceApi {
    if (!service) throw new ApiError(503, 'Layar uji suara belum diaktifkan.');
    return service;
  }
  async function owned(request: FastifyRequest<{ Params: { id: string } }>) {
    const actor = await authenticate(request);
    return { ...actor, id: resourceId(request.params.id) };
  }

  app.post(base + '/sessions', async (request, reply) => {
    const actor = await authenticate(request);
    const api = available();
    const { sdp } = parseInput(offer, request.body);
    const session = await voiceCall(() => api.start({ ...actor, sdp }));
    if (reply.raw.destroyed) {
      await Promise.resolve().then(() => api.stop({ ...actor, id: session.id })).catch(() => {});
      return reply;
    }
    return reply.code(201).send(session);
  });
  app.get<{ Params: { id: string } }>(base + '/sessions/:id/events', async (request, reply) => {
    const owner = await owned(request);
    const api = available();
    await voiceCall(() => openEvents(api, owner, reply));
  });
  app.delete<{ Params: { id: string } }>(base + '/sessions/:id', async (request, reply) => {
    const owner = await owned(request);
    const api = available();
    await voiceCall(() => api.stop(owner));
    return reply.code(204).send();
  });
  app.get<{ Params: { id: string; turnId: string } }>(base + '/sessions/:id/turns/:turnId/audio', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const owner = await owned(request);
    const turn = { turnId: parseInput(turnId, request.params.turnId), ...parseInput(audioQuery, request.query) };
    const api = available();
    const audio = await voiceCall(() => api.takeAudio?.(owner, turn));
    if (!audio) throw new ApiError(404, 'Audio terverifikasi tidak tersedia.');
    return reply.type('audio/wav').send(audio);
  });
  app.post<{ Params: { id: string } }>(base + '/sessions/:id/telemetry', async (request, reply) => {
    const owner = await owned(request);
    const api = available();
    const { elapsedMs, ...turn } = parseInput(playbackSample, request.body);
    const recorded = await voiceCall(() => api.recordBrowserPlayback?.(owner, elapsedMs, turn));
    if (recorded) metrics.observe('delegation_to_browser_playback_proxy', 'sample', elapsedMs);
    return reply.code(204).send();
  });
  app.get(base + '/metrics', (request, reply) => requireAdmin(request, async () =>
    reply.type(metrics.registry.contentType).send(await metrics.registry.metrics())));
}
