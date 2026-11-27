import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WebSocket, WebSocketServer } from 'ws';

function voiced(pcm, amplitude) {
  for (let index = 0; index + 1 < pcm.length; index += 2) {
    if (Math.abs(pcm.readInt16LE(index)) >= amplitude) return true;
  }
  return false;
}

export function createPilotBridge(app, origin, adapter) {
  const token = randomBytes(24).toString('hex');
  const path = '/__voice_audit/stream?token=' + token;
  const server = new WebSocketServer({ noServer: true, maxPayload: 48_000 });
  let peer;
  let active = false;
  let ready = false;
  let turnId;
  let allowed = false;
  let inputEnded = false;
  let sentBytes = 0;
  let forwardedBytes = 0;
  let lastVoicedInputAt;
  let firstProviderVoiceAt;
  let firstVoicedOutputAt;
  let playbackAllowedAt;

  function send(message) {
    if (peer?.readyState === WebSocket.OPEN) peer.send(JSON.stringify(message));
  }

  function signalReady() {
    if (peer?.readyState === WebSocket.OPEN && active && !ready) {
      ready = true;
      send({ type: 'ready' });
    }
  }

  function terminate() {
    allowed = false;
    active = false;
    peer?.close(1011, 'Sesi uji telah ditutup');
  }

  function upgrade(request, socket, head) {
    if (request.url !== path || request.headers.origin !== origin || peer) {
      socket.destroy();
      return;
    }
    server.handleUpgrade(request, socket, head, (connection) => {
      peer = connection;
      connection.on('error', terminate);
      connection.on('message', (chunk, binary) => {
        if (!ready || !active || inputEnded) return;
        if (!binary) {
          if (chunk.toString() === '{"type":"input.end"}') inputEnded = true;
          return;
        }
        try {
          const pcm = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          sentBytes += pcm.byteLength;
          if (sentBytes > 960_000) throw new Error('Data suara uji berlebih.');
          if (voiced(pcm, 164)) lastVoicedInputAt = performance.now();
          adapter.pushPcm(pcm);
        } catch {
          terminate();
        }
      });
      signalReady();
    });
  }
  app.server.on('upgrade', upgrade);
  app.get('/__voice_audit', (_request, reply) => reply
    .header('cache-control', 'no-store').type('text/html; charset=utf-8')
    .send('<!doctype html><html lang="id"><title>Audit audio CEO</title><body><h1>Audit audio CEO</h1><button id="pilot-start">Mulai uji</button></body></html>'));

  function receive(event) {
    if (event.type === 'state') {
      active = event.state === 'active';
      if (['closed', 'unavailable'].includes(event.state)) {
        send({ type: 'done' });
        terminate();
      } else {
        signalReady();
      }
    }
    if (event.type === 'turn') {
      turnId = event.turnId;
      if (allowed) send({ type: 'playback.clear' });
      allowed = false;
    }
    if (event.type === 'result' && event.turnId === turnId) send({ type: 'result', ...event.result });
    if (event.type === 'playback' && event.turnId === turnId) {
      if (allowed && !event.allowed) send({ type: 'playback.clear' });
      allowed = event.allowed;
      if (allowed) playbackAllowedAt = performance.now();
    }
  }

  return {
    path,
    receive,
    audio(pcm) {
      const isVoiced = voiced(pcm, 492);
      if (firstProviderVoiceAt === undefined && isVoiced) firstProviderVoiceAt = performance.now();
      if (!active || !allowed || peer?.readyState !== WebSocket.OPEN) return;
      if (peer.bufferedAmount > 96_000) {
        terminate();
        return;
      }
      if (firstVoicedOutputAt === undefined && isVoiced) firstVoicedOutputAt = performance.now();
      forwardedBytes += pcm.byteLength;
      peer.send(pcm, { binary: true });
    },
    stats: () => ({ sentBytes, forwardedBytes, lastVoicedInputAt, firstProviderVoiceAt, firstVoicedOutputAt, playbackAllowedAt }),
    close() {
      app.server.off('upgrade', upgrade);
      peer?.terminate();
      server.close();
    },
  };
}

export async function subscribePilotEvents(origin, sessionId, cookie, signal, receive) {
  const result = await fetch(origin + '/api/ceo/voice/sessions/' + sessionId + '/events', {
    headers: { cookie, accept: 'text/event-stream' }, signal,
  });
  if (!result.ok || !result.body) throw new Error('Langganan sesi suara ditolak.');
  let buffer = '';
  for await (const text of result.body.pipeThrough(new TextDecoderStream())) {
    buffer += text;
    if (buffer.length > 64_000) throw new Error('Peristiwa suara uji terlalu besar.');
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const record = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (record.startsWith('data: ')) receive(JSON.parse(record.slice(6)));
    }
  }
}
