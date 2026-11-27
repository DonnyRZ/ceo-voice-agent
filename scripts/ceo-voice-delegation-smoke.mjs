import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpsProxyAgent } from 'https-proxy-agent';
import WebSocket from 'ws';
import { activeVoiceMicros, openBudget } from '../backend/modules/ai/budget.ts';
import { readVoiceConfig } from '../backend/modules/ai/config.ts';
import { parseLiveEvent } from '../backend/modules/ai/voice/live-events.ts';
import { ceoVoiceInstructions } from '../backend/modules/ai/voice/prompt.ts';

const config = readVoiceConfig();
const fixture = process.argv[2];
const contractOnly = process.argv[3] === '--delegation-contract';
const transcribeOnly = process.argv[3] === '--transcribe-recording';
const contentProbe = process.argv[3] === '--verify-content';
const [strategy, tag, expected] = process.argv.slice(4);
if (!config || !fixture) throw new Error('Set AI_VOICE_ENABLED=true and supply a synthetic WAV fixture.');
if (contentProbe && (!['commentary', 'guided', 'instructions'].includes(strategy) || !/^[a-z0-9-]{1,40}$/u.test(tag ?? '')
  || !expected?.trim() || expected.length > 300)) throw new Error('Siapkan mode, label, dan kalimat sintetis untuk uji isi.');

// Diagnose the provider protocol with a known fact independently of browser ICE.
const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', fixture, '-ac', '1', '-ar', '24000', '-f', 's16le', '-']);
const maxAudioSeconds = transcribeOnly ? 24 : 16;
if (pcm.length < 48_000 || pcm.length > 48_000 * maxAudioSeconds) {
  throw new Error('Durasi audio di luar batas audit.');
}
const input = Buffer.concat([pcm, Buffer.alloc(48_000 * 8)]);
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const timeLimit = transcribeOnly ? Math.ceil(pcm.length / 48) + 4_000 : 22_000;
const settle = openBudget(config.budgetUsd * 0.9).reserve(activeVoiceMicros(Math.ceil(timeLimit / 1000) + 3), true);
const socket = new WebSocket('wss://api.openai.com/v1/live/sessions', {
  headers: { Authorization: 'Bearer ' + config.apiKey },
  agent: proxy ? new HttpsProxyAgent(proxy) : undefined,
  handshakeTimeout: 5_000,
});
const report = { kind: transcribeOnly ? 'rendered-audio-transcript' : contentProbe ? 'provider-content' : 'provider-protocol',
  started: false, delegated: false, acknowledged: false,
  ...(contentProbe ? { strategy, expected, transcriptEvents: [] } : {}) };
const audio = [];
let sentStart = false;
let sending;
let closeTimer;
let inputDone;
let commentaryId;
let instructionId;
const send = (message) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
};
function end() {
  if (closeTimer) return;
  clearInterval(sending);
  if (socket.readyState === WebSocket.OPEN) send({ type: 'session.close' });
  closeTimer = setTimeout(() => socket.terminate(), 3_000);
}
const deadline = setTimeout(end, timeLimit);

socket.once('open', () => {
  sentStart = true;
  send({ type: 'session.start', session: {
    model: config.voiceModel, store: false,
    instructions: transcribeOnly
      ? 'Ini rekaman sintetis untuk audit. Dengarkan saja. Jangan berbicara atau mendelegasikan.'
      : ceoVoiceInstructions,
    audio: { format: { type: 'audio/pcm', rate: 24000 }, output: { voice: 'marin' } },
    delegation: { type: 'client', acknowledgement_delay_ms: 800 },
  } });
});
socket.on('error', () => { report.socketError = true; });
socket.on('message', (data) => {
  const raw = data.toString('utf8');
  const message = JSON.parse(raw);
  const event = parseLiveEvent(raw);
  if (message.type === 'session.started') {
    report.started = true;
    let offset = 0;
    const deadlineMs = performance.now() + pcm.length / 48;
    sending = setInterval(() => {
      if (offset >= input.length) {
        clearInterval(sending);
        return;
      }
      send({
        type: 'session.input_audio.append',
        audio: input.subarray(offset, offset + 4_800).toString('base64'),
      });
      offset += 4_800;
      inputDone = deadlineMs;
    }, 100);
  }
  if (event?.type === 'delegation' && !report.delegated) {
    report.delegated = true;
    if (contentProbe) report.delegationOffsetMs = event.offsetMs;
    report.delegationShape = {
      eventFields: Object.keys(message).sort(),
      delegationFields: Object.keys(message.delegation).sort(),
      target: message.delegation.target,
    };
    if (contractOnly) {
      end();
      return;
    }
    if (transcribeOnly) return;
    send({ type: 'session.thinking.append', event_id: randomUUID(), delegation_id: event.id, content: '' });
    if (contentProbe && strategy !== 'commentary') {
      instructionId = randomUUID();
      send({ type: 'session.instructions.append', event_id: instructionId, delegation_id: event.id,
        content: strategy === 'instructions'
          ? `Untuk jawaban delegasi ini, ucapkan hanya kalimat dalam kutipan berikut. Pertahankan semua fakta dan urutan kata. ${JSON.stringify(expected)}`
          : 'Untuk jawaban delegasi ini, bacakan persis hasil dari backend berikutnya. Jika hasil itu sebuah fakta, langsung bacakan dan jangan meminta klarifikasi atau menambah informasi.' });
    }
    if (!contentProbe || strategy !== 'instructions') {
      commentaryId = randomUUID();
      send({
        type: 'session.commentary.append', event_id: commentaryId, delegation_id: event.id,
        content: contentProbe ? expected : 'Status proyek Upgrade Infrastruktur di divisi IT adalah Pending.',
      });
    }
  }
  if (event?.type === 'commentary_accepted' && event.eventId === commentaryId) {
    report.acknowledged = true;
    if (contentProbe) report.commentaryEndMs = event.endMs;
  }
  if (contentProbe && message.type === 'session.instructions.appended' && message.client_event_id === instructionId) {
    report.instructionsEndMs = message.end_ms;
  }
  if (contentProbe && event?.type === 'transcript') report.transcriptEvents.push(event.fragment);
  if (event?.type === 'transcript' && event.fragment.role === 'assistant') {
    report.outputTranscript = (report.outputTranscript ?? '') + event.fragment.text;
  }
  if (transcribeOnly && event?.type === 'transcript' && event.fragment.role === 'user') {
    const { text, startMs, endMs } = event.fragment;
    report.fragments ??= [];
    report.fragments.push({ text, startMs, endMs });
    report.inputTranscript = (report.inputTranscript ?? '') + text;
  }
  if (!contentProbe && message.type === 'session.output_audio.delta' && typeof message.delta === 'string' && report.acknowledged) {
    const chunk = Buffer.from(message.delta, 'base64');
    if (!audio.length) report.firstProviderAudioMs = inputDone === undefined ? null : Math.round(performance.now() - inputDone);
    audio.push(chunk);
  }
  if (message.type === 'error') report.providerError = message.error?.code ?? 'unknown';
  if (event?.type === 'closed') {
    report.billedSeconds = event.seconds;
    if (event.seconds !== undefined) settle(activeVoiceMicros(event.seconds));
    socket.close();
  }
});

await new Promise((resolve) => socket.once('close', resolve));
clearInterval(sending);
clearTimeout(deadline);
clearTimeout(closeTimer);
if (!sentStart || !report.started && report.providerError === 'integer_above_max_value') settle(0);
const directory = '.voice-pilot';
await mkdir(directory, { recursive: true, mode: 0o700 });
report.audioBytes = audio.reduce((total, chunk) => total + chunk.length, 0);
if (!contractOnly && !transcribeOnly && audio.length) {
  await writeFile(join(directory, 'provider-response.pcm'), Buffer.concat(audio), { mode: 0o600 });
}
const reportName = contentProbe ? `provider-content-${tag}.json` : contractOnly ? 'delegation-contract.json' : transcribeOnly
  ? basename(fixture, '.wav') + '-transcript.json' : 'delegation.json';
await writeFile(join(directory, reportName), JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: contentProbe ? 'wx' : 'w' });
console.log(JSON.stringify(report));
const passed = contentProbe ? report.delegated && Boolean(report.outputTranscript?.trim())
  : contractOnly ? report.delegated : transcribeOnly ? Boolean(report.inputTranscript?.trim())
  : report.acknowledged && report.audioBytes > 0;
if (!passed || report.billedSeconds === undefined) process.exitCode = 1;
