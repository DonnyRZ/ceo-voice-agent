import { createHash } from 'node:crypto';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { voicePcmBytesPerMs } from '../shared/voice-pcm.ts';
import { verifiedVoiceWav } from '../backend/modules/ai/voice/wav.ts';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function readReflectionArtifact(file) {
  const metadataStat = await stat(file);
  if (!metadataStat.isFile() || metadataStat.size > 1_500_000) {
    throw new Error('Ukuran metadata trace PCM tidak valid.');
  }
  const trace = JSON.parse(await readFile(file, 'utf8'));
  const expectedPcm = basename(file).replace(/-reflection\.json$/, '-reflection.pcm');
  if (trace.version !== 1 || trace.representation !== 'parsed-live-events' || trace.truncated ||
      trace.sampleRate !== 24_000 || trace.channels !== 1 || trace.format !== 's16le' ||
      !/^[a-z0-9-]{1,113}-reflection\.pcm$/.test(expectedPcm) || trace.pcm !== expectedPcm ||
      !Array.isArray(trace.events) || trace.events.length > 12_000) {
    throw new Error('Trace PCM tidak lengkap atau formatnya tidak didukung.');
  }
  const pcmFile = join(dirname(file), expectedPcm);
  const pcmStat = await stat(pcmFile);
  if (!pcmStat.isFile() || pcmStat.size > 4 * 1024 * 1024 || pcmStat.size !== trace.pcmBytes) {
    throw new Error('Ukuran PCM tidak cocok dengan metadata.');
  }
  const pcm = await readFile(pcmFile);
  if (sha256(pcm) !== trace.sha256) throw new Error('SHA-256 PCM tidak cocok dengan metadata.');
  const events = unpackReflectionEvents(trace.events, pcm);
  const inputEnds = new Map();
  for (const { delegationId, endMs } of trace.journal?.inputEnds ?? []) {
    if (typeof delegationId === 'string' && Number.isSafeInteger(endMs) && endMs >= 0) inputEnds.set(delegationId, endMs);
  }
  const stops = (trace.journal?.stops ?? []).filter(({ delegationId, atMs }) =>
    typeof delegationId === 'string' && Number.isFinite(atMs) && atMs >= 0 && atMs <= 120_000);
  for (const { atMs, delegationId } of stops) events.push({ atMs, event: { type: 'journal_revoked', delegationId } });
  events.sort((left, right) => left.atMs - right.atMs);
  return { events, inputEnds, applicationRevocationMarkers: stops.length };
}

function unpackReflectionEvents(rows, pcm) {
  let previousTime = 0;
  let nextByte = 0;
  const events = rows.map((row, index) => {
    const { atMs, event, sequence } = row;
    if (sequence !== index + 1 || !Number.isFinite(atMs) || atMs < previousTime || atMs > 120_000 ||
        !event || typeof event.type !== 'string') {
      throw new Error('Urutan trace PCM tidak valid.');
    }
    previousTime = atMs;
    if (event.type !== 'output_audio') return row;
    const { startMs, endMs, pcmOffset, pcmLength } = event.frame;
    if (pcmOffset !== nextByte || !Number.isSafeInteger(pcmLength) || pcmLength < 1 || nextByte + pcmLength > pcm.length) {
      throw new Error('Lokasi frame tidak cocok dengan PCM.');
    }
    nextByte += pcmLength;
    return { ...row, event: { ...event, frame: { startMs, endMs, pcm: pcm.subarray(pcmOffset, nextByte) } } };
  });
  if (nextByte !== pcm.length) throw new Error('Trace PCM memiliki byte tanpa frame.');
  return events;
}

export function matchRawReflection(frames, { pcm, startMs, endMs }) {
  let position = startMs;
  const pieces = [];
  for (const frame of frames) {
    const from = Math.max(startMs, frame.startMs);
    const to = Math.min(endMs, frame.endMs);
    if (from >= to) continue;
    if (from !== position) return { reflectedBytesMatch: false };
    pieces.push(frame.pcm.subarray((from - frame.startMs) * voicePcmBytesPerMs, (to - frame.startMs) * voicePcmBytesPerMs));
    position = to;
  }
  const wav = verifiedVoiceWav(pcm);
  return {
    reflectedBytesMatch: position === endMs && Buffer.concat(pieces).equals(pcm),
    clipSha256: sha256(pcm), wavSha256: wav && sha256(wav), wav,
  };
}

export async function saveReflectionWav(tracePath, ordinal, wav) {
  const directory = await realpath(dirname(tracePath));
  const workspaceArtifacts = await realpath(resolve('.voice-pilot'));
  const location = relative(workspaceArtifacts, directory);
  if (location === '..' || location.startsWith('../')) throw new Error('Simpan WAV replay di dalam .voice-pilot.');
  const file = basename(tracePath).replace(/-reflection\.json$/, `-replay-${ordinal}.wav`);
  await writeFile(join(directory, file), wav, { mode: 0o600, flag: 'wx' });
  return file;
}
