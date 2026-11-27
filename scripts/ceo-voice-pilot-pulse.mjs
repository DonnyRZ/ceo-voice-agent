import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { summarizePilot } from './ceo-voice-pilot-report.mjs';

function readPcm(wav) {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Rekaman PulseAudio harus berupa WAV PCM.');
  }
  let rate;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const type = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > wav.length) break;
    if (type === 'fmt ' && size >= 16) {
      const monoPcm16 = wav.readUInt16LE(start) === 1 && wav.readUInt16LE(start + 2) === 1
        && wav.readUInt16LE(start + 14) === 16;
      rate = monoPcm16 ? wav.readUInt32LE(start + 4) : undefined;
    }
    if (type === 'data' && rate >= 8000 && rate <= 96000 && size % 2 === 0) {
      const pcm = wav.subarray(start, start + size);
      const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
      return { rate, pcm, samples };
    }
    offset = start + size + size % 2;
  }
  throw new Error('Rekaman PulseAudio harus berisi WAV PCM mono 16 bit yang lengkap.');
}

function findMarkers(samples, rate) {
  const at = (ms) => Math.round(ms * rate / 1000);
  const window = at(20);
  const [first, second] = [1817, 2939].map((hz) => 2 * Math.cos(2 * Math.PI * hz / rate));
  function isTone(start, coefficient) {
    let previous = 0, earlier = 0, power = 0;
    for (let frame = start; frame < start + window; frame++) {
      const sample = samples[frame];
      power += sample * sample;
      const current = sample + coefficient * previous - earlier;
      earlier = previous;
      previous = current;
    }
    const band = previous * previous + earlier * earlier - coefficient * previous * earlier;
    return power > window * 500 ** 2 && 2 * band > 0.87 * window * power;
  }
  const markers = [];
  for (let frame = 0; frame + at(175) < samples.length; frame += at(5)) {
    if (!isTone(frame, first) || !isTone(frame + at(35), first)) continue;
    // A short device-buffer gap can split the second tone. Corroborate within its scheduled window.
    if (!isTone(frame + at(115), second) || ![140, 145, 150, 155].some((offset) => isTone(frame + at(offset), second))) continue;
    markers.push(frame);
    frame += at(220);
  }
  return markers;
}

function encodeWav(pcm, rate) {
  const header = Buffer.alloc(44);
  header.write('RIFF');
  header.write('WAVEfmt ', 8);
  header.write('data', 36);
  for (const [offset, value] of [[4, pcm.length + 36], [16, 16], [24, rate], [28, 2 * rate], [40, pcm.length]]) {
    header.writeUInt32LE(value, offset);
  }
  for (const [offset, value] of [[20, 1], [22, 1], [32, 2], [34, 16]]) header.writeUInt16LE(value, offset);
  return Buffer.concat([header, pcm]);
}

const [reportPath, recordingPath] = process.argv.slice(2);
if (!reportPath?.endsWith('.json') || !recordingPath) {
  throw new Error('Gunakan node scripts/ceo-voice-pilot-pulse.mjs <laporan.json> <monitor.wav>.');
}
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const { pcm, samples: monitor, rate } = readPcm(await readFile(recordingPath));
const markers = findMarkers(monitor, rate);
const expected = report.samples.filter(({ capture }) => Number.isSafeInteger(capture?.pulseSyncFrame));
if (!markers.length || markers.length !== expected.length) {
  throw new Error(`Penanda PulseAudio tidak cocok. Terdeteksi ${markers.length}, diharapkan ${expected.length}.`);
}

const name = basename(reportPath, '.json') + '-pulse';
const directory = dirname(reportPath);
const aligned = [];
let index = 0;
for (const sample of report.samples) {
  const { capture, recording, recordingSha256, assessment, ...result } = sample;
  if (!Number.isSafeInteger(capture?.pulseSyncFrame)) {
    aligned.push({ ...result, capture: undefined, error: result.error ?? 'Penanda PulseAudio tidak tersedia.' });
    continue;
  }
  if (!/^[a-z0-9-]+$/.test(result.id)) throw new Error('Identitas skenario tidak valid.');
  const marker = markers[index++];
  const { sampleRate, pulseSyncFrame, recordingStartFrame, recordingEndFrame, speechStartFrame, speechEndFrame } = capture;
  const toMonitor = (frame) => marker + Math.round((frame - pulseSyncFrame) * rate / sampleRate);
  const start = toMonitor(recordingStartFrame);
  const end = toMonitor(recordingEndFrame);
  if (!(start > marker && end > start && end <= (markers[index] ?? monitor.length))) {
    throw new Error(`Rentang audio tidak valid pada skenario ${result.id}.`);
  }
  let first = start;
  let last = end - 1;
  while (first < end && Math.abs(monitor[first]) < 492) first += 1;
  while (last >= first && Math.abs(monitor[last]) < 492) last -= 1;
  const toBrowser = (frame) => recordingStartFrame + Math.round((frame - start) * sampleRate / rate);
  const firstAudibleFrame = first < end ? toBrowser(first) : null;
  const lastAudibleFrame = first < end ? toBrowser(last) : null;
  const elapsed = (startFrame) => firstAudibleFrame === null ? null : Math.round((firstAudibleFrame - startFrame) * 1000 / sampleRate);
  result.capture = {
    ...capture, captureMode: 'isolated-pulse-monitor', firstAudibleFrame, lastAudibleFrame,
    firstAudibleMs: elapsed(speechEndFrame), firstAudibleFromSpeechStartMs: elapsed(speechStartFrame),
  };
  if (firstAudibleFrame !== null) {
    result.recording = `${name}-${result.id}.wav`;
    const wav = encodeWav(pcm.subarray(start * 2, end * 2), rate);
    result.recordingSha256 = createHash('sha256').update(wav).digest('hex');
    await writeFile(join(directory, result.recording), wav, { mode: 0o600 });
  }
  aligned.push(result);
}
const outputPath = join(directory, name + '.json');
const output = { ...report, audioCapture: 'isolated-pulse-monitor', ...summarizePilot(aligned) };
await writeFile(outputPath, JSON.stringify(output, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ report: outputPath, markers: markers.length, withPlayback: output.summary.withPlayback }));
