import { readFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import { createVoiceInput } from '../backend/modules/ai/voice/input.ts';

const [reportFile, caseId] = process.argv.slice(2);
if (!reportFile || !caseId) throw new Error('Berikan laporan pilot dan ID skenario untuk diputar ulang.');
const report = JSON.parse(await readFile(reportFile, 'utf8'));
const sample = report.samples.find(({ id }) => id === caseId);
if (!sample?.journal?.transcriptEvents?.length) throw new Error('Skenario belum memiliki fragmen mentah bertimestamp.');

function replayable({ entry }) {
  return entry.type === 'delegation_received' || entry.metric?.type === 'state'
    || entry.type === 'transcript' && entry.fragment.role === 'user';
}

const trace = [sample.replayPrelude, sample.journal].filter(Boolean)
  .flatMap(({ events, transcriptEvents }) => [...events,
    ...transcriptEvents.map(({ fragment, ...row }) => ({ ...row, entry: { type: 'transcript', fragment } }))])
  .filter(replayable).sort((a, b) => a.sequence - b.sequence);
const times = trace.map(({ recordedAt }) => Date.parse(recordedAt));
if (times.some((time) => !Number.isFinite(time)) || times.at(-1) - times[0] > 70_000) {
  throw new Error('Rentang waktu replay tidak sah atau melebihi 70 detik.');
}

const assembled = [];
const withheld = [];
const canceled = [];
let current;
const voice = createVoiceInput({
  begin(id, offsetMs) {
    if (current && offsetMs <= current.offsetMs) return false;
    current = { id, offsetMs };
    return true;
  },
  observeUserAudio(endMs) {
    if (current && endMs > current.offsetMs) canceled.push({ id: current.id, endMs });
  },
  prepare() {},
  resolve({ id, text, userEndMs, offsetMs }) { assembled.push({ id, text, userEndMs, offsetMs }); },
  unverifiedInput(id) { withheld.push(id); },
}, { prepareCandidates: false, metric() {} });

const begin = performance.now();
try {
  for (const [index, { entry }] of trace.entries()) {
    const remaining = times[index] - times[0] - (performance.now() - begin);
    if (remaining > 0) await wait(remaining);
    if (entry.type === 'transcript') voice.append(entry.fragment);
    else if (entry.type === 'delegation_received') voice.delegate(entry.turnId, entry.offsetMs);
    else if (entry.metric?.state === 'standby') voice.pause();
  }
  await wait(1_300);
} finally {
  voice.close();
}

const previous = sample.journal.events.filter(({ entry }) => entry.type === 'turn_input').map(({ entry }) => entry);
console.log(JSON.stringify({ caseId, traceEvents: trace.length, previous, assembled, withheld, canceled }, null, 2));
