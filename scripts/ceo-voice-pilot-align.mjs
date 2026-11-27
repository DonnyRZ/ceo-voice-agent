import { readFile } from 'node:fs/promises';
import { spectralBands } from './ceo-voice-pilot-spectrum.mjs';
import { decodePilotWav } from './ceo-voice-pilot-wav.mjs';

const hz = 12_000;
const bin = hz / 100;
const maxFrames = 40 * hz;
const voiceThreshold = 128;
const timeTolerance = bin * 2;

function renderAtCommonRate({ rate, pcm }) {
  const frames = pcm.length / 2;
  const outputFrames = Math.floor(frames * hz / rate);
  if (!outputFrames || outputFrames > maxFrames) throw new Error('Durasi bukti audio berada di luar rentang pilot.');
  const output = new Float32Array(outputFrames);
  for (let frame = 0; frame < output.length; frame += 1) {
    const from = Math.floor(frame * rate / hz);
    const to = Math.max(from + 1, Math.floor((frame + 1) * rate / hz));
    for (let source = from; source < to; source += 1) output[frame] += pcm.readInt16LE(2 * source);
    output[frame] /= to - from;
  }
  return output;
}

function levels(audio) {
  const bins = new Float32Array(Math.floor(audio.length / bin));
  for (let index = 0; index < bins.length; index += 1) {
    let squares = 0;
    for (let sample = index * bin; sample < (index + 1) * bin; sample += 1) squares += audio[sample] ** 2;
    bins[index] = Math.log1p(Math.sqrt(squares / bin) / voiceThreshold);
  }
  return bins;
}

function correlation(reference, browser, lag, minLength, step = 1) {
  const from = Math.max(0, -lag);
  const to = Math.min(reference.length, browser.length - lag);
  if (to - from < minLength) return -1;
  let n = 0, sumR = 0, sumB = 0, powerR = 0, powerB = 0, cross = 0;
  for (let i = from; i < to; i += step) {
    const r = reference[i];
    const b = browser[i + lag];
    n += 1;
    sumR += r;
    sumB += b;
    powerR += r * r;
    powerB += b * b;
    cross += r * b;
  }
  const variance = (powerR - sumR * sumR / n) * (powerB - sumB * sumB / n);
  return variance > 0 ? (cross - sumR * sumB / n) / Math.sqrt(variance) : -1;
}

function findLag(ref, capture) {
  const r = levels(ref);
  const minBins = Math.max(20, Math.ceil(r.length * .45));
  const { bands, values: expected } = spectralBands(ref, bin);
  let result = { lag: null, score: -1, energy: -1, expected, bands };
  for (const offset of [0, bin / 2]) {
    const shifted = capture.subarray(offset);
    const c = levels(shifted);
    const coarse = [];
    for (let bins = minBins - r.length; bins <= c.length - minBins; bins += 1) {
      const score = correlation(r, c, bins, minBins);
      if (score > .2) coarse.push({ bins, score });
    }
    coarse.sort((a, b) => b.score - a.score);
    const { values: browser } = spectralBands(shifted, bin);
    for (const { bins, score: energy } of coarse.slice(0, 24)) {
      const score = correlation(expected, browser, bins * bands, minBins * bands);
      if (.8 * score + .2 * energy > .8 * result.score + .2 * result.energy) {
        result = { bins, lag: bins * bin + offset, score, energy, expected, browser, bands };
      }
    }
  }
  return result;
}

function voiceBounds(audio) {
  const start = audio.findIndex((sample) => Math.abs(sample) >= voiceThreshold);
  const last = audio.findLastIndex((sample) => Math.abs(sample) >= voiceThreshold);
  return start >= 0 ? { start, end: last + 1 } : undefined;
}

function containsExtraAudio(audio, from, to) {
  const outside = [audio.subarray(0, Math.max(0, from)), audio.subarray(Math.max(0, to))];
  return outside.some((part) => levels(part).filter((value) => value > Math.log1p(492 / voiceThreshold)).length >= 2);
}

function windowCorrelations(ref, capture, lag, from, to, bands) {
  const size = bands * 12;
  const scores = [];
  for (let start = from; start < to; start += size) {
    const part = ref.subarray(start, Math.min(start + size, to));
    if (part.length < bands * 4 || !part.some((value) => value >= 2)) continue;
    // Capture timestamps are quantized. Allow a single frame of local jitter
    // while still requiring each resolved window to match the same readout.
    scores.push(Math.max(...[-bands, 0, bands].map((skew) =>
      correlation(part, capture, start + lag + skew, part.length))));
  }
  return scores;
}

const ms = (frames) => Math.round(frames * 100_000 / hz) / 100;
const round = (value) => Math.round(value * 10_000) / 10_000;

export function comparePilotWaveforms(sourceWav, browserWav) {
  const source = decodePilotWav(sourceWav);
  const browser = decodePilotWav(browserWav);
  const ref = renderAtCommonRate(source);
  const capture = renderAtCommonRate(browser);
  const voice = voiceBounds(ref);
  const evidence = { sourceSha256: source.sha256, browserSha256: browser.sha256, browserRecordingMs: ms(capture.length) };
  if (!voice || !voiceBounds(capture)) return { ...evidence, outcome: 'incomplete', reason: 'missing_waveform' };

  const { lag, bins, score, energy, bands, expected, browser: measured } = findLag(ref, capture);
  const correlations = { spectralCorrelation: round(score), energyCorrelation: round(energy), alignmentResolutionMs: 5 };
  if (lag === null || score < .88 || energy < .8)
    return { ...evidence, ...correlations, outcome: 'mismatch', reason: 'different_waveform' };
  const from = Math.max(voice.start, -lag);
  const to = Math.min(voice.end, capture.length - lag);
  const firstBand = Math.ceil(from / bin) * bands;
  const lastBand = Math.min(expected.length, measured.length - bins * bands, Math.floor(to / bin) * bands);
  const windows = windowCorrelations(expected, measured, bins * bands, firstBand, lastBand, bands);
  const minimumWindowCorrelation = Math.min(...windows);
  const matched = { ...evidence, ...correlations, lagMs: ms(lag),
    comparedVoicedWindows: windows.length, minimumWindowCorrelation: windows.length ? round(minimumWindowCorrelation) : null,
    sourceVoicedMs: ms(voice.end - voice.start), matchedVoicedMs: ms(to - from),
    firstMatchedMs: ms(from + lag), lastMatchedMs: ms(to + lag),
    missingPrefixMs: ms(from - voice.start), missingSuffixMs: ms(voice.end - to) };
  if (windows.length < 3 || minimumWindowCorrelation < .75) {
    return { ...matched, outcome: 'mismatch', reason: 'local_waveform_changed' };
  }
  if (from - voice.start > timeTolerance || voice.end - to > timeTolerance) {
    return { ...matched, outcome: 'incomplete', reason: 'truncated_playback' };
  }
  if (containsExtraAudio(capture, voice.start + lag - timeTolerance, voice.end + lag + timeTolerance)) {
    return { ...matched, outcome: 'mismatch', reason: 'unexpected_audio_outside_readout' };
  }
  return { ...matched, outcome: 'match' };
}

if (import.meta.main) {
  const [sourcePath, browserPath] = process.argv.slice(2);
  if (!sourcePath || !browserPath) throw new Error('Gunakan node scripts/ceo-voice-pilot-align.mjs SUMBER.wav BROWSER.wav.');
  const bytes = await Promise.all([readFile(sourcePath), readFile(browserPath)]);
  console.log(JSON.stringify(comparePilotWaveforms(...bytes), null, 2));
}
