import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { inspectPilotWav } from './ceo-voice-pilot-wav.mjs';

function audio(rate = 24_000, seconds = 2) {
  const size = rate * seconds * 2;
  const bytes = Buffer.alloc(44 + size);
  bytes.write('RIFF');
  bytes.write('WAVEfmt ', 8);
  bytes.write('data', 36);
  for (const [offset, value] of [[4, size + 36], [16, 16], [24, rate], [28, rate * 2], [40, size]]) {
    bytes.writeUInt32LE(value, offset);
  }
  for (const [offset, value] of [[20, 1], [22, 1], [32, 2], [34, 16]]) bytes.writeUInt16LE(value, offset);
  for (const position of [0.5, 40_000 / 24_000]) bytes.writeInt16LE(2_000, 44 + 2 * Math.round(rate * position));
  return bytes;
}

function evidence(bytes, capture = {}) {
  return {
    recordingSha256: createHash('sha256').update(bytes).digest('hex'),
    capture: { captureMode: 'browser-tab-audio', sampleRate: 24_000, recordingStartFrame: 500,
      recordingEndFrame: 48_500, firstAudibleFrame: 12_500, lastAudibleFrame: 40_500, ...capture },
  };
}

test('checks the exact committed capture bytes and browser clock span', () => {
  const bytes = audio();
  const sample = evidence(bytes);
  assert.deepEqual(inspectPilotWav(bytes, sample, { firstFactEndSeconds: 1, answerEndSeconds: 1.5 }),
    { rate: 24_000, seconds: 2, sha256: sample.recordingSha256 });
  bytes[44] = 2;
  assert.throws(() => inspectPilotWav(bytes, sample), /berbeda dari laporan/);
});

test('Pulse monitor resampling preserves time alignment within one frame rounding', () => {
  const bytes = audio(48_000);
  assert.equal(inspectPilotWav(bytes, evidence(bytes, { captureMode: 'isolated-pulse-monitor' })).seconds, 2);
  assert.throws(() => inspectPilotWav(bytes, evidence(bytes)), /Durasi/);
  assert.throws(() => inspectPilotWav(bytes, evidence(bytes, {
    captureMode: 'isolated-pulse-monitor', recordingEndFrame: 50_000,
  })), /Durasi/);
});

test('rejects malformed data length and timestamps outside the physical WAV', () => {
  const bytes = audio();
  assert.throws(() => inspectPilotWav(bytes, evidence(bytes), { firstFactEndSeconds: 1, answerEndSeconds: 2.1 }),
    /di luar rekaman/);
  bytes.writeUInt32LE(18, 40);
  assert.throws(() => inspectPilotWav(bytes, evidence(bytes)), /Format audio/);
});

test('claimed browser playback requires a detectable waveform at the reported bounds', () => {
  const bytes = audio();
  assert.throws(() => inspectPilotWav(bytes, evidence(bytes, { firstAudibleFrame: 12_800 })), /Batas suara/);
  bytes.fill(0, 44);
  assert.throws(() => inspectPilotWav(bytes, evidence(bytes)), /Batas suara/);
});
