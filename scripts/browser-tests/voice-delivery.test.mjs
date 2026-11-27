import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifiedVoiceWav } from '../../backend/modules/ai/voice/wav.ts';
import { observePilotDelivery } from '../ceo-voice-pilot-delivery.mjs';
const sessionsPath = '/api/ceo/voice/sessions';
const wav = verifiedVoiceWav(Buffer.alloc(48, 6));
const options = { sessionsPath, session: () => 'example' };
async function withDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), 'pilot-browser-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

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
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
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
