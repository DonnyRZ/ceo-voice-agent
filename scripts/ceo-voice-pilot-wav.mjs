import { createHash } from 'node:crypto';

const audibleThreshold = 492;

function audibleBounds(bytes, frames) {
  const audible = (frame) => Math.abs(bytes.readInt16LE(44 + 2 * frame)) >= audibleThreshold;
  let first = 0;
  let last = frames - 1;
  while (first <= last && !audible(first)) first += 1;
  while (last > first && !audible(last)) last -= 1;
  return first < frames ? { first, last } : undefined;
}

export function decodePilotWav(bytes) {
  const size = bytes.length - 44;
  if (size <= 0 || size % 2 || bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.toString('ascii', 8, 16) !== 'WAVEfmt ' || bytes.toString('ascii', 36, 40) !== 'data' ||
      bytes.readUInt32LE(4) !== bytes.length - 8 || bytes.readUInt32LE(16) !== 16 ||
      bytes.readUInt16LE(20) !== 1 || bytes.readUInt16LE(22) !== 1 || bytes.readUInt16LE(32) !== 2 ||
      bytes.readUInt16LE(34) !== 16 || bytes.readUInt32LE(40) !== size) {
    throw new Error('Format audio pilot tidak valid.');
  }
  const rate = bytes.readUInt32LE(24);
  if (rate < 8_000 || rate > 96_000 || bytes.readUInt32LE(28) !== rate * 2) {
    throw new Error('Laju sampel audio pilot tidak valid.');
  }
  return { rate, pcm: bytes.subarray(44), sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function inspectPilotWav(bytes, sample, review) {
  const { rate, pcm, sha256 } = decodePilotWav(bytes);
  if (sample.recordingSha256 !== sha256) {
    throw new Error('Rekaman pilot berbeda dari laporan.');
  }

  const seconds = pcm.length / (2 * rate);
  const { captureMode, sampleRate, recordingStartFrame, recordingEndFrame, firstAudibleFrame, lastAudibleFrame } =
    sample.capture ?? {};
  const pulse = captureMode === 'isolated-pulse-monitor';
  if (!['browser-tab-audio', 'isolated-pulse-monitor'].includes(captureMode) ||
      !Number.isSafeInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 96_000 ||
      ![recordingStartFrame, recordingEndFrame, firstAudibleFrame, lastAudibleFrame].every(Number.isSafeInteger) ||
      recordingStartFrame < 0 || firstAudibleFrame < recordingStartFrame || firstAudibleFrame > lastAudibleFrame ||
      lastAudibleFrame > recordingEndFrame - (pulse ? 0 : 1)) {
    throw new Error('Rentang tangkapan audio pilot tidak valid.');
  }
  const recordedSeconds = (recordingEndFrame - recordingStartFrame) / sampleRate;
  const frameTolerance = pulse ? 1 / rate + 1 / sampleRate : 0;
  if (Math.abs(recordedSeconds - seconds) > frameTolerance ||
      (captureMode === 'browser-tab-audio' && rate !== sampleRate)) {
    throw new Error('Durasi audio pilot tidak sesuai dengan tangkapan browser.');
  }
  const bounds = audibleBounds(bytes, pcm.length / 2);
  const browserFrame = (wavFrame) => recordingStartFrame + Math.round(wavFrame * sampleRate / rate);
  const boundaryTolerance = pulse ? 1 : Math.ceil(sampleRate / 1_000);
  if (!bounds || Math.abs(browserFrame(bounds.first) - firstAudibleFrame) > boundaryTolerance ||
      Math.abs(browserFrame(bounds.last) - lastAudibleFrame) > boundaryTolerance) {
    throw new Error('Batas suara tangkapan tidak sesuai isi WAV.');
  }
  if (review && (![review.firstFactEndSeconds, review.answerEndSeconds].every(Number.isFinite) ||
      review.firstFactEndSeconds < 0 || review.firstFactEndSeconds > review.answerEndSeconds ||
      review.answerEndSeconds > seconds)) {
    throw new Error('Stempel waktu peninjauan di luar rekaman.');
  }
  return { rate, seconds, sha256 };
}
