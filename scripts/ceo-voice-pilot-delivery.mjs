import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { maximumVoiceWavBytes, voicePcmSampleRate, voiceWavHeaderBytes } from '../shared/voice-pcm.ts';
import { decodePilotWav } from './ceo-voice-pilot-wav.mjs';

const maximumResponses = 8;
const captureTimeoutMs = 1_500;
const captureSource = 'chromium-cdp-fetch-response';

function errorDetails(error) {
  return {
    code: String(error?.code ?? error?.name ?? 'unknown').slice(0, 80),
    message: String(error?.message ?? 'Capture failed').replace(/\b(?:sk-|Bearer\s+)\S+/gu, '[REDACTED]').slice(0, 200),
  };
}

function validWav(wav, size) {
  if (wav.length !== size) return false;
  try { return decodePilotWav(wav).rate === voicePcmSampleRate; } catch { return false; }
}

async function bounded(work) {
  let timer;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Capture operation timed out')), captureTimeoutMs);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

export async function observePilotDelivery(page, { origin, sessionsPath, session }) {
  const opening = Promise.resolve().then(() => page.context().newCDPSession(page));
  let cdp;
  try {
    cdp = await bounded(opening);
  } catch (error) {
    void opening.then((connection) => connection.detach()).catch(() => {});
    throw new Error(`Could not initialize CDP response capture (${errorDetails(error).code}).`);
  }
  let phase = 'setup';
  let closing = false;
  let cleanup;
  const captured = [];
  const pending = new Set();
  const paused = new Map();
  const cleanupErrors = [];
  let overflow = false;

  function resume(requestId, entry) {
    const state = paused.get(requestId);
    if (!state) return Promise.resolve();
    state.resuming ??= bounded(Promise.resolve().then(() => cdp.send('Fetch.continueResponse', { requestId }))).catch((error) => {
      if (entry) entry.resumeError = errorDetails(error);
      else cleanupErrors.push(errorDetails(error));
    }).finally(() => paused.delete(requestId));
    return state.resuming;
  }

  async function responsePaused(response) {
    const { requestId } = response;
    paused.set(requestId, {});
    let entry;
    try {
      if (closing || response.request.method !== 'GET') return;
      const url = new URL(response.request.url);
      const id = session();
      const prefix = `${sessionsPath}/${encodeURIComponent(id)}/turns/`;
      if (!id || url.origin !== origin || !url.pathname.startsWith(prefix)) return;
      const turn = /^([^/]+)\/audio$/.exec(url.pathname.slice(prefix.length));
      const generation = Number(url.searchParams.get('generation'));
      if (!turn || !Number.isSafeInteger(generation) || generation < 1) return;
      if (captured.length >= maximumResponses) { overflow = true; return; }
      entry = { phase, turnId: decodeURIComponent(turn[1]), generation,
        httpStatus: response.responseStatusCode, captureSource };
      captured.push(entry);
      if (entry.httpStatus !== 200) return;
      const headers = Object.fromEntries((response.responseHeaders ?? []).map(({ name, value }) => [name.toLowerCase(), value]));
      const size = Number(headers['content-length']);
      if (headers['content-type']?.split(';')[0].trim() !== 'audio/wav' || !Number.isSafeInteger(size)
        || size <= voiceWavHeaderBytes || size > maximumVoiceWavBytes) {
        entry.error = 'invalid_headers';
        return;
      }
      const result = await bounded(cdp.send('Fetch.getResponseBody', { requestId }));
      if (typeof result.body !== 'string' || result.body.length > Math.ceil(maximumVoiceWavBytes / 3) * 4) {
        entry.error = 'invalid_body';
        return;
      }
      const encoding = result.base64Encoded ? 'base64' : 'utf8';
      if (Buffer.byteLength(result.body, encoding) !== size) { entry.error = 'invalid_body'; return; }
      const wav = Buffer.from(result.body, encoding);
      if (!validWav(wav, size)) {
        entry.error = 'invalid_body';
        return;
      }
      entry.wav = wav;
    } catch (error) {
      if (entry) { entry.error = 'body_unavailable'; entry.captureError = errorDetails(error); }
      else cleanupErrors.push(errorDetails(error));
    } finally {
      await resume(requestId, entry);
    }
  }

  function received(response) {
    const work = responsePaused(response);
    pending.add(work);
    void work.finally(() => pending.delete(work));
  }
  cdp.on('Fetch.requestPaused', received);
  try {
    await bounded(cdp.send('Fetch.enable', { patterns: [{
      urlPattern: `${origin}${sessionsPath}/*/turns/*/audio*`, requestStage: 'Response',
    }] }));
  } catch (error) {
    cdp.off('Fetch.requestPaused', received);
    await bounded(cdp.send('Fetch.disable')).catch(() => {});
    await bounded(cdp.detach()).catch(() => {});
    throw new Error(`Could not initialize CDP response capture (${errorDetails(error).code}).`);
  }

  async function close() {
    if (cleanup) return cleanup;
    closing = true;
    cleanup = (async () => {
      await bounded(Promise.allSettled([...pending])).catch((error) => cleanupErrors.push(errorDetails(error)));
      await Promise.allSettled([...paused.keys()].map((id) => resume(id)));
      await bounded(cdp.send('Fetch.disable')).catch((error) => cleanupErrors.push(errorDetails(error)));
      cdp.off('Fetch.requestPaused', received);
      await bounded(cdp.detach()).catch((error) => cleanupErrors.push(errorDetails(error)));
    })();
    return cleanup;
  }

  return {
    target() { phase = 'target'; },
    close,
    async save(directory, prefix) {
      await close();
      const recordings = [];
      for (const [index, entry] of captured.entries()) {
        const { wav, ...report } = entry;
        if (!wav) { recordings.push(report); continue; }
        const recording = `${prefix}-delivered-${index + 1}.wav`;
        await writeFile(join(directory, recording), wav, { mode: 0o600, flag: 'wx' });
        recordings.push({ ...report, recording, sha256: createHash('sha256').update(wav).digest('hex'), bytes: wav.length });
      }
      return { recordings, overflow, captureSource, cleanupErrors };
    },
  };
}
