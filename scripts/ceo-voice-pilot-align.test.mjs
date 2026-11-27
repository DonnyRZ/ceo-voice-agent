import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { comparePilotWaveforms } from './ceo-voice-pilot-align.mjs';
import { verifyPilotWaveforms } from './ceo-voice-pilot-waveform-review.mjs';

const rate = 24_000;
const pad = (seconds) => new Int16Array(Math.round(seconds * rate));

function voiced(pattern) {
  const out = pad(pattern.length * .2);
  for (let i = 0; i < out.length; i += 1) {
    const time = i / rate;
    const segment = Math.floor(time / .2);
    const progress = (time - segment * .2) / .2;
    const volume = (0.4 + .5 * Math.sin(Math.PI * progress)) * (segment % 2 ? 1 : .6);
    const first = 2 * Math.PI * pattern[segment] * time;
    out[i] = Math.round(volume * (3_500 * Math.sin(first) + 1_750 * Math.cos(first * 2.4)));
  }
  return out;
}

function wav(parts) {
  const frames = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF');
  bytes.write('WAVEfmt ', 8);
  bytes.write('data', 36);
  for (const [offset, value] of [[4, bytes.length - 8], [16, 16], [24, rate], [28, rate * 2], [40, frames * 2]]) {
    bytes.writeUInt32LE(value, offset);
  }
  for (const [offset, value] of [[20, 1], [22, 1], [32, 2], [34, 16]]) bytes.writeUInt16LE(value, offset);
  let offset = 44;
  for (const part of parts) {
    for (const value of part) {
      bytes.writeInt16LE(value, offset);
      offset += 2;
    }
  }
  return bytes;
}

const expected = voiced([155, 400, 240, 600, 330, 780, 360, 200, 500, 275, 410, 220]);
const different = voiced([1200, 1600, 1100, 1350, 1000, 1850, 1600, 1080, 1550, 1100, 1780, 1300]);
const reference = wav([pad(.08), expected, pad(.4)]);

test('aligns a complete reference with a delayed native WAV capture', () => {
  const review = comparePilotWaveforms(reference, wav([pad(1.2), expected, pad(.7)]));
  assert.equal(review.outcome, 'match');
  assert.equal(review.lagMs, 1_120);
  assert.equal(review.missingPrefixMs, 0);
  assert.equal(review.missingSuffixMs, 0);
});

test('rejects another source with the same duration and envelope', () => {
  const review = comparePilotWaveforms(reference, wav([pad(1.2), different, pad(.7)]));
  assert.equal(review.outcome, 'mismatch');
});

test('identifies missing initial and final audio separately', () => {
  const first = comparePilotWaveforms(reference, wav([expected.subarray(rate * .2), pad(.5)]));
  assert.equal(first.outcome, 'incomplete');
  assert.equal(first.reason, 'truncated_playback');
  assert.ok(first.missingPrefixMs >= 195 && first.missingSuffixMs === 0);
  const last = comparePilotWaveforms(reference, wav([pad(1.2), expected.subarray(0, expected.length - rate * .2)]));
  assert.equal(last.outcome, 'incomplete');
  assert.equal(last.reason, 'truncated_playback');
  assert.ok(last.missingPrefixMs === 0 && last.missingSuffixMs >= 195);
});

test('a recognizable reference cannot conceal wrong speech before or after it', () => {
  for (const browser of [
    wav([pad(1), different.subarray(0, rate * .3), pad(.2), expected, pad(.5)]),
    wav([pad(1), expected, pad(.2), different.subarray(0, rate * .3), pad(.5)]),
  ]) {
    const review = comparePilotWaveforms(reference, browser);
    assert.equal(review.outcome, 'mismatch');
    assert.equal(review.reason, 'unexpected_audio_outside_readout');
  }
});

test('a replaced word-sized window is rejected despite matching the surrounding WAV', () => {
  const altered = expected.slice();
  altered.set(different.subarray(0, rate * .2), rate);
  const review = comparePilotWaveforms(reference, wav([pad(1.2), altered, pad(.7)]));
  assert.equal(review.outcome, 'mismatch');
  assert.equal(review.reason, 'local_waveform_changed');
  assert.ok(review.spectralCorrelation > .88);
});

test('verified target retains only the matching turn and provider interval', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-waveform-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const turnId = 'current';
  const generation = 2;
  const capture = wav([pad(1.2), expected, pad(.7)]);
  const captureFrames = (capture.length - 44) / 2;
  const audible = (frame) => Math.abs(capture.readInt16LE(44 + 2 * frame)) >= 492;
  let first = 0, last = captureFrames - 1;
  while (!audible(first)) first += 1;
  while (!audible(last)) last -= 1;
  const pcm = reference.subarray(44);
  const startMs = 1_000;
  const endMs = startMs + pcm.length / 48;
  const trace = { file: 'reflection.json', pcm: 'reflection.pcm', sha256: sha(pcm), pcmBytes: pcm.length };
  const verification = { cutoffMs: startMs, speechStartMs: startMs + 80,
    speechEndMs: endMs - 400, lastFrameEndMs: endMs };
  const delivery = { phase: 'target', httpStatus: 200, turnId, generation, recording: 'served.wav',
    bytes: reference.length, sha256: sha(reference) };
  const sample = {
    id: 'case', recording: 'captured.wav', recordingSha256: sha(capture), providerTrace: trace,
    capture: { captureMode: 'browser-tab-audio', sampleRate: rate, recordingStartFrame: 0, recordingEndFrame: captureFrames,
      firstAudibleFrame: first, lastAudibleFrame: last },
    backend: { turnId, generation },
    playbackEvidence: [delivery],
    journal: { events: [
      { sequence: 1, entry: { type: 'metric', turnId, metric: { stage: 'output_verify', outcome: 'verified', output: verification } } },
      { sequence: 2, entry: { type: 'playback', turnId, generation, allowed: true } },
    ] },
  };
  await Promise.all([
    writeFile(join(directory, sample.recording), capture),
    writeFile(join(directory, delivery.recording), reference),
    writeFile(join(directory, trace.pcm), pcm),
    writeFile(join(directory, trace.file), JSON.stringify({ ...trace, representation: 'parsed-live-events',
      channels: 1, format: 's16le', sampleRate: rate,
      events: [{ event: { type: 'output_audio', frame: { startMs, endMs, pcmOffset: 0, pcmLength: pcm.length } } }],
    })),
  ]);
  const verify = async () => (await verifyPilotWaveforms({ samples: [sample] }, directory)).cases[0];
  assert.equal((await verify()).outcome, 'match');
  verification.cutoffMs += 500;
  assert.equal((await verify()).reason, 'reflected_source_outside_verified_turn');
  delivery.generation -= 1;
  assert.equal((await verify()).reason, 'missing_unique_delivery');
});
