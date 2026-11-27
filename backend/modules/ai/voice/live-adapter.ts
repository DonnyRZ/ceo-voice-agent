import { randomUUID } from 'node:crypto';
import { HttpsProxyAgent } from 'https-proxy-agent';
import OpenAI, { APIError } from 'openai';
import WebSocket from 'ws';
import { parseLiveEvent } from './live-events.js';
import { ceoVoiceInstructions } from './prompt.js';
import type { LiveHandlers, LiveSideband, VoiceAdapter } from './types.js';

const openTimeoutMs = 5_000;
const cleanupOpenTimeoutMs = 1_500;
const closeTimeoutMs = 2_000;
const heartbeatMs = 15_000;

export class LiveCreateHttpError extends Error {
  constructor(readonly status: number) {
    super(`OpenAI Live session creation failed with HTTP ${status}`);
    this.name = 'LiveCreateHttpError';
  }
}

export function createLiveAdapter(options: {
  apiKey: string;
  model: string;
  idleTimeoutSeconds?: number;
  proxyUrl?: string;
}): VoiceAdapter {
  const { apiKey, model, idleTimeoutSeconds = 10, proxyUrl } = options;
  const client = new OpenAI({ apiKey, baseURL: 'https://api.openai.com/v1', maxRetries: 0, logLevel: 'off' });
  const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

  async function createSession(sdp: string, signal: AbortSignal) {
    const result = await client.live.create({
      session: {
        model,
        instructions: ceoVoiceInstructions,
        store: false,
        audio: { output: { voice: 'marin' } },
        wake_policy: { type: 'speech' },
        idle_timeout_s: idleTimeoutSeconds,
        delegation: { type: 'client', acknowledgement_delay_ms: 800 },
        client: { data_channel: { allowed_client_events: [], allowed_server_events: [] } },
      },
      transport: { type: 'webrtc', sdp },
    }, { signal, timeout: 10_000 }).catch((error: unknown) => {
      if (error instanceof APIError && typeof error.status === 'number') throw new LiveCreateHttpError(error.status);
      signal.throwIfAborted();
      throw new Error('OpenAI Live session creation could not be confirmed');
    });

    const id = result?.session?.id;
    if (typeof id === 'string' && id.length > 0) {
      const answer = result.transport?.sdp;
      if (result.transport?.type === 'webrtc' && typeof answer === 'string' && answer.length > 0) {
        return { id, sdp: answer };
      }
      await closeSession(id);
    }
    throw new Error('OpenAI Live returned an incomplete session');
  }

  async function attach(id: string, handlers: LiveHandlers, signal: AbortSignal): Promise<LiveSideband> {
    signal.throwIfAborted();
    const socket = new WebSocket(`wss://api.openai.com/v1/live/sessions/${encodeURIComponent(id)}/attach`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      agent,
      handshakeTimeout: openTimeoutMs,
      perMessageDeflate: false,
      maxPayload: 1024 * 1024,
    });
    return connectSideband(socket, handlers, signal);
  }

  async function closeSession(id: string, sideband?: LiveSideband, onEvent?: LiveHandlers['onEvent']) {
    if (await sideband?.finish()) return;

    try {
      const cleanup = await attach(id, {
        onEvent: (event) => { if (event.type === 'closed') onEvent?.(event); },
        onDisconnect: () => {},
      }, AbortSignal.timeout(cleanupOpenTimeoutMs));
      await cleanup.finish();
    } catch {
      // The original session may already have closed.
    }
  }

  return { createSession, attach, closeSession };
}

async function connectSideband(socket: WebSocket, handlers: LiveHandlers, signal: AbortSignal): Promise<LiveSideband> {
  let attached = false;
  let serverClosed = false;
  let awaitingPong = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let finishing = false;
  let finishPromise: Promise<boolean> | undefined;
  let finishResolve: ((confirmed: boolean) => void) | undefined;

  socket.on('message', (data, isBinary) => {
    if (isBinary) return;
    const bytes = Array.isArray(data) ? Buffer.concat(data) : data;
    const message = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const event = parseLiveEvent(message.toString('utf8'));
    if (!event) return;

    if (event.type !== 'closed') {
      handlers.onEvent(event);
      return;
    }

    serverClosed = true;
    try {
      handlers.onEvent(event);
    } finally {
      finishResolve?.(true);
      socket.terminate();
    }
  });
  socket.on('pong', () => { awaitingPong = false; });
  socket.on('close', () => {
    clearInterval(heartbeat);
    finishResolve?.(serverClosed);
    if (attached && !finishing && !serverClosed) handlers.onDisconnect();
  });
  socket.on('error', () => { socket.terminate(); });

  const onAbort = () => { socket.terminate(); };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => {
        heartbeat = setInterval(() => {
          if (awaitingPong) {
            socket.terminate();
          } else if (socket.readyState === WebSocket.OPEN) {
            awaitingPong = true;
            socket.ping(undefined, undefined, (error) => { if (error) socket.terminate(); });
          }
        }, heartbeatMs);
        heartbeat.unref();
        resolve();
      });
      socket.once('close', () => reject(signal.reason ?? new Error('OpenAI Live sideband could not connect')));
    });
    signal.throwIfAborted();
    if (socket.readyState !== WebSocket.OPEN && !serverClosed) throw new Error('OpenAI Live sideband could not connect');
    attached = true;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }

  function sendCommentary(eventId: string, delegationId: string, text: string) {
    if (socket.readyState !== WebSocket.OPEN || finishing || serverClosed) {
      throw new Error('OpenAI Live sideband is closed');
    }
    socket.send(JSON.stringify({
      type: 'session.commentary.append', event_id: eventId, delegation_id: delegationId, content: text,
    }), (error) => { if (error) socket.terminate(); });
  }

  function finish(): Promise<boolean> {
    if (finishPromise) return finishPromise;
    if (serverClosed) return Promise.resolve(true);
    if (socket.readyState !== WebSocket.OPEN) return Promise.resolve(false);

    finishing = true;
    finishPromise = new Promise((resolve) => {
      const timer = setTimeout(() => finishResolve?.(false), closeTimeoutMs);
      finishResolve = (confirmed) => {
        finishResolve = undefined;
        clearTimeout(timer);
        socket.terminate();
        resolve(confirmed);
      };
      try {
        socket.send(JSON.stringify({ type: 'session.close' }), (error) => { if (error) finishResolve?.(false); });
      } catch {
        finishResolve(false);
      }
    });
    return finishPromise;
  }

  function silenceAcknowledgment(delegationId: string) {
    if (socket.readyState !== WebSocket.OPEN || finishing || serverClosed) return;
    try {
      socket.send(JSON.stringify({
        type: 'session.thinking.append', event_id: randomUUID(), delegation_id: delegationId, content: '',
      }), (error) => { if (error) socket.terminate(); });
    } catch {
      socket.terminate();
    }
  }

  return { silenceAcknowledgment, sendCommentary, finish };
}
