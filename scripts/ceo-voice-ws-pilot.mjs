import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { chromium, firefox } from 'playwright';
import { createApp } from '../backend/app.ts';
import { readConfig } from '../backend/config.ts';
import { devCeoEmail } from '../backend/db/admin-account.ts';
import { readVoiceConfig } from '../backend/modules/ai/config.ts';
import { createVoiceWebSocketAdapter } from './ceo-voice-websocket-adapter.mjs';
import { createPilotBridge, subscribePilotEvents } from './ceo-voice-ws-bridge.mjs';
import { runVoiceWebSocketBrowser } from './ceo-voice-ws-browser.mjs';

const [fixture, expectedTitle, expectedStatus, expectedIntent, expectedPic] = process.argv.slice(2);
const password = process.env.SEED_PASSWORD;
if (!fixture || !expectedTitle || !expectedStatus || !password) {
  throw new Error('Berikan WAV sintetis, judul catatan seed, dan status seed.');
}
if (process.env.AI_VOICE_ENABLED !== 'true') throw new Error('Aktifkan AI_VOICE_ENABLED untuk pilot.');

// The loopback pilot reads seed facts. Background embedding is unnecessary.
process.env.AI_EMBEDDINGS_ENABLED = 'false';
process.env.AI_VOICE_MAX_DURATION_SECONDS = '45';
const config = readVoiceConfig();
const wav = await readFile(fixture);
const origin = 'http://127.0.0.1:3802';
const directory = resolve('.voice-pilot');
const tag = process.env.PILOT_REPORT_TAG;
if (tag && !/^[a-z0-9-]{1,40}$/.test(tag)) throw new Error('Tag laporan tidak sah.');
const base = basename(fixture, '.wav') + (tag ? '-' + tag : '');
const report = {
  fixture: basename(fixture), transport: 'loopback-browser-websocket-and-live-primary-websocket',
  model: config.voiceModel, expected: { name: expectedTitle, status: expectedStatus, intent: expectedIntent, pic: expectedPic },
};
const inputTranscript = [];
const outputTranscript = [];
const runtimeMetrics = [];
let delegationAt;
let bridge;
let browser;
let context;
let sessionUrl;
let events;
const controller = new AbortController();
const adapter = createVoiceWebSocketAdapter({
  apiKey: config.apiKey, model: config.voiceModel,
  proxyUrl: process.env.HTTPS_PROXY || process.env.https_proxy,
  onAudio: (pcm) => bridge?.audio(pcm),
  onEvent(event) {
    if (event.type === 'delegation') delegationAt = performance.now();
    if (event.type === 'transcript' && event.fragment.role === 'user') {
      inputTranscript.push(event.fragment.text);
    }
    if (event.type === 'transcript' && event.fragment.role === 'assistant') {
      outputTranscript.push(event.fragment.text);
    }
    if (event.type === 'closed') report.billedSeconds = event.seconds;
  },
  onProviderError: (code) => { report.providerError = code; },
});
const app = await createApp(readConfig({
  ...process.env, APP_ORIGIN: origin, API_PORT: '3802', HOST: '127.0.0.1',
}), { voiceAudit: { adapter, observe: (metric) => runtimeMetrics.push({ at: performance.now(), metric }) } });

function breakdown(stream) {
  const lookup = runtimeMetrics.findLast(({ metric }) => metric.type === 'retrieval');
  const ack = runtimeMetrics.findLast(({ metric }) => metric.type === 'latency' && metric.stage === 'commentary_ack');
  const provider = runtimeMetrics.findLast(({ metric }) => metric.type === 'latency' && metric.stage === 'input_to_delegation');
  const between = (end, start) => Number.isFinite(end) && Number.isFinite(start) ? Math.round(end - start) : undefined;
  return {
    voicedInputToDelegation: between(delegationAt, stream.lastVoicedInputAt),
    providerSpeechOffsetToDelegation: provider?.metric.durationMs,
    delegationToLookupStart: between(lookup?.at - lookup?.metric.durationMs, delegationAt),
    lookup: between(lookup?.metric.durationMs, 0),
    lookupToCommentaryStart: between(ack?.at - ack?.metric.durationMs, lookup?.at),
    commentaryAck: between(ack?.metric.durationMs, 0),
    providerVoiceRelativeToAck: between(stream.firstProviderVoiceAt, ack?.at),
    ackToPlaybackAllowed: between(stream.playbackAllowedAt, ack?.at),
    gateToVoicedPcm: between(stream.firstVoicedOutputAt, stream.playbackAllowedAt),
  };
}

try {
  bridge = createPilotBridge(app, origin, adapter);
  await app.listen({ host: '127.0.0.1', port: 3802 });
  const engine = process.env.PILOT_BROWSER === 'firefox' ? firefox : chromium;
  report.browser = engine.name();
  browser = await engine.launch({
    executablePath: engine === chromium ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE : undefined,
    args: engine === chromium ? ['--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] : undefined,
  });
  context = await browser.newContext();
  const signIn = await context.request.post(origin + '/api/auth/sign-in/email', {
    headers: { origin }, data: { email: devCeoEmail, password }, timeout: 8_000,
  });
  if (!signIn.ok()) throw new Error('Login CEO uji ditolak dengan HTTP ' + signIn.status());
  const page = await context.newPage();
  await page.goto(origin + '/__voice_audit');
  const start = await context.request.post(origin + '/api/ceo/voice/sessions', {
    headers: { origin }, data: { sdp: 'v=0\r\ns=local-audio-audit\r\n' }, timeout: 12_000,
  });
  report.startup = start.status();
  if (!start.ok()) throw new Error('Pembukaan sesi ditolak dengan HTTP ' + start.status());
  const { id } = await start.json();
  sessionUrl = origin + '/api/ceo/voice/sessions/' + id;
  const cookie = (await context.cookies(origin)).map(({ name, value }) => name + '=' + value).join('; ');
  const controls = [];
  events = subscribePilotEvents(origin, id, cookie, controller.signal, (event) => {
    controls.push(event);
    bridge.receive(event);
  }).catch(() => {
    if (!controller.signal.aborted) {
      report.eventError = true;
      bridge.receive({ type: 'state', state: 'unavailable' });
    }
  });
  const result = await runVoiceWebSocketBrowser(page, {
    wsPath: bridge.path, wavBase64: wav.toString('base64'), timeoutMs: 22_000,
  });
  const { recordingBase64, ...timing } = result;
  report.playback = timing;
  const stream = bridge.stats();
  const { sentBytes, forwardedBytes } = stream;
  report.stream = { sentBytes, forwardedBytes };
  report.serverTimingMs = breakdown(stream);
  const facts = controls.findLast(({ type }) => type === 'result')?.result;
  report.backendResult = facts;
  report.factsCorrect = expectedStatus === 'clarify'
    ? facts?.kind === 'clarify' && !facts.facts
    : facts?.kind === 'facts' && facts.facts?.entity?.name === expectedTitle && facts.facts?.status === expectedStatus
      && (!expectedIntent || facts.facts?.intent === expectedIntent)
      && (!expectedPic || facts.facts?.picName === expectedPic);
  if (recordingBase64) {
    const file = resolve(directory, 'browser-ws-' + base + '.wav');
    await writeFile(file, Buffer.from(recordingBase64, 'base64'), { mode: 0o600 });
    report.recording = basename(file);
  }
} catch (error) {
  report.error = error instanceof Error ? error.message.split('\n')[0] : 'Pilot gagal.';
} finally {
  if (context && sessionUrl) {
    await context.request.delete(sessionUrl, { headers: { origin }, timeout: 8_000 }).catch(() => {});
  }
  controller.abort();
  await events;
  bridge?.close();
  await browser?.close();
  await app.close();
  report.inputTranscript = inputTranscript.join('');
  report.outputTranscript = outputTranscript.join('');
  await writeFile(resolve(directory, 'browser-ws-' + base + '.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report));
}

if (report.error || !report.factsCorrect || !report.recording || report.billedSeconds === undefined) process.exitCode = 1;
