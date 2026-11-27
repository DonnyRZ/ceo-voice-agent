import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifiedVoiceWav } from '../backend/modules/ai/voice/wav.ts';
import { observePilotDelivery } from './ceo-voice-pilot-delivery.mjs';

const origin = 'http://127.0.0.1:3801';
const sessionsPath = '/api/ceo/voice/sessions';
const wav = verifiedVoiceWav(Buffer.alloc(48, 6));

function harness(failure) {
  const cdp = new EventEmitter();
  const commands = [];
  const responses = new Map();
  let sequence = 0;
  cdp.send = async (method, params) => {
    commands.push({ method, params });
    if (failure) await failure(method, params);
    if (method === 'Fetch.getResponseBody') return responses.get(params.requestId);
  };
  cdp.detach = async () => { cdp.detached = true; };
  const page = { context: () => ({ newCDPSession: async () => cdp }) };
  function emit({ url = `${origin}${sessionsPath}/example/turns/sample/audio?generation=7`,
    status = 200, length = wav.length, method = 'GET', body = wav } = {}) {
    const requestId = String(++sequence);
    responses.set(requestId, { body: body.toString('base64'), base64Encoded: true });
    cdp.emit('Fetch.requestPaused', { requestId, request: { url, method }, responseStatusCode: status,
      responseHeaders: [{ name: 'Content-Type', value: 'audio/wav' }, { name: 'Content-Length', value: String(length) }] });
    return requestId;
  }
  return { page, cdp, commands, emit };
}

async function withDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), 'pilot-delivery-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

const options = { origin, sessionsPath, session: () => 'example' };

test('captures bounded paused WAV bytes, preserves phase and resumes every response', async () => withDirectory(async (directory) => {
  const h = harness();
  const capture = await observePilotDelivery(h.page, options);
  h.emit({ url: `${origin}${sessionsPath}/another/turns/sample/audio?generation=7` });
  h.emit({ method: 'POST' });
  h.emit({ status: 404 });
  capture.target();
  h.emit();
  h.emit({ length: 10_000_000 });
  h.emit({ body: Buffer.alloc(wav.length) });
  const { recordings, overflow, captureSource, cleanupErrors } = await capture.save(directory, 'synthetic');
  assert.equal(overflow, false);
  assert.equal(captureSource, 'chromium-cdp-fetch-response');
  assert.deepEqual(cleanupErrors, []);
  assert.equal(recordings.length, 4);
  assert.equal(recordings[0].httpStatus, 404);
  assert.equal(recordings[0].phase, 'setup');
  assert.equal(recordings[0].recording, undefined);
  assert.equal(recordings[1].phase, 'target');
  assert.equal(recordings[1].turnId, 'sample');
  assert.equal(recordings[1].generation, 7);
  assert.match(recordings[1].sha256, /^[a-f0-9]{64}$/);
  const file = join(directory, recordings[1].recording);
  assert.deepEqual(await readFile(file), wav);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(recordings[2].error, 'invalid_headers');
  assert.equal(recordings[3].error, 'invalid_body');
  assert.equal(h.commands.filter(({ method }) => method === 'Fetch.getResponseBody').length, 2);
  assert.equal(h.commands.filter(({ method }) => method === 'Fetch.continueResponse').length, 6);
  assert.equal(h.cdp.listenerCount('Fetch.requestPaused'), 0);
  assert.equal(h.cdp.detached, true);
}));

test('resumes failed captures and retains bounded redacted error detail', async () => withDirectory(async (directory) => {
  const h = harness(async (method) => {
    if (method === 'Fetch.getResponseBody') throw Object.assign(new Error('Missing sk-fixture-secret'), { code: 'ERR_BODY' });
  });
  const capture = await observePilotDelivery(h.page, options);
  h.emit();
  const { recordings } = await capture.save(directory, 'failed');
  assert.equal(recordings[0].error, 'body_unavailable');
  assert.equal(recordings[0].captureError.code, 'ERR_BODY');
  assert.equal(recordings[0].captureError.message, 'Missing [REDACTED]');
  assert.equal(h.commands.some(({ method }) => method === 'Fetch.continueResponse'), true);
  assert.equal(h.cdp.detached, true);
}));

test('fails setup when interception cannot be installed and releases the CDP session', async () => {
  const h = harness(async (method) => { if (method === 'Fetch.enable') throw new Error('Unavailable'); });
  await assert.rejects(observePilotDelivery(h.page, options), /initialize CDP response capture/u);
  assert.equal(h.commands.some(({ method }) => method === 'Fetch.disable'), true);
  assert.equal(h.cdp.listenerCount('Fetch.requestPaused'), 0);
  assert.equal(h.cdp.detached, true);
});

test('fails immediately when Chromium cannot create a CDP session', async () => {
  const page = { context: () => ({ newCDPSession: async () => { throw new Error('Disconnected'); } }) };
  await assert.rejects(observePilotDelivery(page, options), /initialize CDP response capture/u);
});

test('limits stored responses while continuing overflow responses', async () => withDirectory(async (directory) => {
  const h = harness();
  const capture = await observePilotDelivery(h.page, options);
  for (let index = 0; index < 9; index++) h.emit({ status: 404 });
  const result = await capture.save(directory, 'overflow');
  assert.equal(result.recordings.length, 8);
  assert.equal(result.overflow, true);
  assert.equal(h.commands.filter(({ method }) => method === 'Fetch.continueResponse').length, 9);
}));

test('a body-read timeout still resumes delivery and closes interception', async () => withDirectory(async (directory) => {
  const h = harness(async (method) => { if (method === 'Fetch.getResponseBody') await new Promise(() => {}); });
  const capture = await observePilotDelivery(h.page, options);
  h.emit();
  const { recordings } = await capture.save(directory, 'timeout');
  assert.equal(recordings[0].error, 'body_unavailable');
  assert.match(recordings[0].captureError.message, /timed out/u);
  assert.equal(h.commands.some(({ method }) => method === 'Fetch.continueResponse'), true);
  assert.equal(h.cdp.detached, true);
}));
