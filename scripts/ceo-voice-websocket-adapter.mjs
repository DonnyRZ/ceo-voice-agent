import { randomUUID } from 'node:crypto';
import { HttpsProxyAgent } from 'https-proxy-agent';
import WebSocket from 'ws';
import { LiveCreateHttpError } from '../backend/modules/ai/voice/live-adapter.ts';
import { parseLiveEvent } from '../backend/modules/ai/voice/live-events.ts';
import { ceoVoiceInstructions } from '../backend/modules/ai/voice/prompt.ts';

const endpoint = 'wss://api.openai.com/v1/live/sessions';
const shutdownMs = 2_000;
const pcmBytesPerSecond = 48_000;
const maximumBufferedBytes = 512 * 1024;

/** Primary audio transport for the budget-wrapped audit runtime. One connection at a time. */
export function createVoiceWebSocketAdapter({ apiKey, model, proxyUrl, onAudio, onEvent, onProviderError }) {
  if (!apiKey || !model) throw new Error('OpenAI voice configuration is required for the audit.');
  const proxy = proxyUrl ? new URL(proxyUrl) : undefined;
  if (proxy && !['http:', 'https:'].includes(proxy.protocol)) throw new Error('The audit proxy must use HTTP or HTTPS.');
  const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
  let current;

  async function createSession(sdp, signal) {
    signal.throwIfAborted();
    if (current && current.socket.readyState !== WebSocket.CLOSED) throw new Error('The audit already has an open Live session.');
    current = openAuditSession({ apiKey, model, agent, signal, onAudio, onEvent, onProviderError });
    return { id: await current.started, sdp };
  }

  async function attach(id, handlers, signal) {
    signal.throwIfAborted();
    if (current?.id !== id) throw new Error('Live audit session was not found.');
    return current.attach(handlers);
  }

  async function closeSession(id, sideband, onClosed) {
    if (current?.id !== id) return;
    if (sideband) await sideband.finish();
    else await current.close(onClosed);
  }

  function pushPcm(pcm) {
    if (!(pcm instanceof Uint8Array) || pcm.byteLength === 0 || pcm.byteLength % 2 !== 0 || pcm.byteLength > pcmBytesPerSecond) {
      throw new Error('Expected up to one second of 24 kHz mono PCM16LE audio.');
    }
    if (!current) throw new Error('Start the audit Live session before sending audio.');
    current.pushPcm(pcm);
  }

  return { createSession, attach, closeSession, pushPcm };
}

function openAuditSession({ apiKey, model, agent, signal, onAudio, onEvent, onProviderError }) {
  const socket = new WebSocket(endpoint, {
    headers: { Authorization: `Bearer ${apiKey}` }, agent, handshakeTimeout: 5_000,
    followRedirects: false, perMessageDeflate: false, maxPayload: 1024 * 1024,
  });
  const pending = [];
  let id;
  let handlers;
  let startSent = false;
  let closeSent = false;
  let terminalEvent;
  let finishPromise;
  let resolveFinish;
  let closeTimer;
  let resolveStart;
  let rejectStart;
  const started = new Promise((resolve, reject) => {
    resolveStart = resolve;
    rejectStart = reject;
  });

  function send(event) {
    if (socket.readyState !== WebSocket.OPEN) throw new Error('OpenAI Live audit connection is closed.');
    socket.send(JSON.stringify(event), (error) => { if (error) socket.terminate(); });
  }

  function sendClose() {
    if (closeSent || !id || socket.readyState !== WebSocket.OPEN) return;
    closeSent = true;
    try { send({ type: 'session.close', event_id: randomUUID() }); }
    catch { socket.terminate(); }
  }

  function finish() {
    if (socket.readyState === WebSocket.CLOSED) return Promise.resolve(Boolean(terminalEvent));
    if (finishPromise) return finishPromise;
    finishPromise = new Promise((resolve) => { resolveFinish = resolve; });
    closeTimer = setTimeout(() => socket.terminate(), shutdownMs);
    if (!startSent) socket.terminate();
    else sendClose();
    return finishPromise;
  }

  const abortStart = () => {
    rejectStart(signal.reason);
    void finish();
  };
  signal.addEventListener('abort', abortStart, { once: true });
  if (signal.aborted) abortStart();

  function notify(event) {
    onEvent?.(event);
    if (handlers) handlers.onEvent(event);
    else if (pending.length < 64) pending.push(event);
  }

  socket.once('open', () => {
    if (finishPromise) return;
    try {
      send({ type: 'session.start', event_id: randomUUID(), session: {
        model, instructions: ceoVoiceInstructions, store: false,
        audio: { format: { type: 'audio/pcm', rate: 24_000 }, output: { voice: 'marin' } },
        delegation: { type: 'client', acknowledgement_delay_ms: 800 },
      } });
      startSent = true;
    } catch {
      socket.terminate();
    }
  });
  socket.once('unexpected-response', (_request, response) => {
    response.resume();
    rejectStart(new LiveCreateHttpError(response.statusCode ?? 502));
    socket.terminate();
  });
  socket.on('error', () => { socket.terminate(); });
  socket.once('close', () => {
    clearTimeout(closeTimer);
    signal.removeEventListener('abort', abortStart);
    rejectStart(new Error('The Live audit socket closed during startup.'));
    resolveFinish?.(Boolean(terminalEvent));
    if (!finishPromise && !terminalEvent) handlers?.onDisconnect();
  });

  socket.on('message', (data, binary) => {
    if (binary) return;
    const raw = data.toString('utf8');
    let message;
    try { message = JSON.parse(raw); }
    catch { socket.terminate(); return; }

    if (message?.type === 'session.started' && !id && typeof message.session?.id === 'string' && message.session.id) {
      id = message.session.id;
      signal.removeEventListener('abort', abortStart);
      resolveStart(id);
      if (finishPromise) sendClose();
      else notify({ type: 'active' });
      return;
    }
    if (message?.type === 'session.output_audio.delta') {
      if (!finishPromise && typeof message.delta === 'string') {
        const pcm = Buffer.from(message.delta, 'base64');
        if (pcm.length > 0 && pcm.length % 2 === 0) onAudio?.(pcm);
      }
      return;
    }
    if (message?.type === 'error') {
      const code = message.error?.code;
      onProviderError?.(typeof code === 'string' && /^[a-z0-9_]{1,80}$/i.test(code) ? code : 'unknown');
      if (!id) {
        rejectStart(new Error('OpenAI rejected the Live audit session configuration.'));
        void finish();
      }
    }

    const event = parseLiveEvent(raw);
    if (event?.type === 'closed') {
      terminalEvent = event;
      try { notify(event); }
      finally { socket.terminate(); }
    } else if (event) {
      notify(event);
    }
  });

  return {
    socket,
    started,
    get id() { return id; },
    attach(nextHandlers) {
      if (handlers) throw new Error('The Live audit session already has a listener.');
      handlers = nextHandlers;
      for (const event of pending.splice(0)) handlers.onEvent(event);
      if (socket.readyState === WebSocket.CLOSED && !terminalEvent) handlers.onDisconnect();
      return {
        silenceAcknowledgment(delegationId) {
          if (!finishPromise) send({ type: 'session.thinking.append', event_id: randomUUID(), delegation_id: delegationId, content: '' });
        },
        sendCommentary(eventId, delegationId, text) {
          if (finishPromise) throw new Error('The Live audit session is ending.');
          send({ type: 'session.commentary.append', event_id: eventId, delegation_id: delegationId, content: text });
        },
        finish,
      };
    },
    pushPcm(pcm) {
      if (!id || !handlers || finishPromise) throw new Error('The Live audit session cannot accept audio.');
      if (socket.bufferedAmount > maximumBufferedBytes) throw new Error('The Live audit audio connection is backlogged.');
      send({ type: 'session.input_audio.append', audio: Buffer.from(pcm).toString('base64') });
    },
    async close(onClosed) {
      await finish();
      if (!handlers && terminalEvent) onClosed?.(terminalEvent);
    },
  };
}
