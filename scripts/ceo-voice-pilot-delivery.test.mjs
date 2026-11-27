import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
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


test('Chromium intercepts the one-shot response and resumes the page fetch with identical bytes', { timeout: 45_000 },
  async () => withDirectory(async (directory) => {
    let audioRequests = 0;
    const server = createServer((request, response) => {
      if (request.url === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end('<!doctype html><title>Local delivery evidence</title>');
      } else if (request.url?.includes('/turns/sample/audio')) {
        audioRequests++;
        response.writeHead(audioRequests === 1 ? 200 : 404, {
          'Content-Type': 'audio/wav', 'Content-Length': audioRequests === 1 ? wav.length : 0,
          'Cache-Control': 'no-store',
        });
        response.end(audioRequests === 1 ? wav : undefined);
      } else { response.writeHead(404); response.end(); }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const localOrigin = `http://127.0.0.1:${server.address().port}`;
    let browser;
    let capture;
    try {
      browser = await chromium.launch({ headless: true, timeout: 10_000, args: ['--no-sandbox'],
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
          ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined) });
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(8_000);
      capture = await observePilotDelivery(page, { ...options, origin: localOrigin });
      await page.goto(localOrigin);
      const missing = `${localOrigin}${sessionsPath}/example/turns/missing/audio?generation=6`;
      assert.equal(await page.evaluate(async (url) => (await fetch(url, { signal: AbortSignal.timeout(5_000) })).status, missing), 404);
      capture.target();
      const audioUrl = `${localOrigin}${sessionsPath}/example/turns/sample/audio?generation=7`;
      const received = await page.evaluate(async (url) => {
        const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
        return { status: response.status, bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
      }, audioUrl);
      assert.equal(received.status, 200);
      assert.deepEqual(Buffer.from(received.bytes), wav);
      assert.equal(audioRequests, 1);
      const result = await capture.save(directory, 'actual-chromium');
      assert.deepEqual(result.cleanupErrors, []);
      assert.equal(result.recordings[0].phase, 'setup');
      assert.equal(result.recordings[0].httpStatus, 404);
      assert.equal(result.recordings[1].phase, 'target');
      assert.equal(result.recordings[1].captureSource, 'chromium-cdp-fetch-response');
      assert.equal(result.recordings[1].error, undefined);
      assert.deepEqual(await readFile(join(directory, result.recordings[1].recording)), wav);
      assert.equal(audioRequests, 1);
      assert.equal(await page.evaluate(async () => (await fetch('/', { signal: AbortSignal.timeout(5_000) })).status), 200);
    } finally {
      await capture?.close();
      await browser?.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }));
