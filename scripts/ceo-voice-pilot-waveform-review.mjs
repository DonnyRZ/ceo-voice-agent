import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { comparePilotWaveforms } from './ceo-voice-pilot-align.mjs';
import { decodePilotWav, inspectPilotWav } from './ceo-voice-pilot-wav.mjs';

const wavName = /^[a-z0-9-]+\.wav$/;

async function findReflectedSource(directory, trace, source) {
  if (!trace || trace.truncated || !/^[a-z0-9-]+\.json$/.test(trace.file) || !/^[a-z0-9-]+\.pcm$/.test(trace.pcm)) return;
  const [json, pcm] = await Promise.all([
    readFile(join(directory, trace.file), 'utf8'), readFile(join(directory, trace.pcm)),
  ]);
  const log = JSON.parse(json);
  const sha256 = createHash('sha256').update(pcm).digest('hex');
  if (log.truncated || log.representation !== 'parsed-live-events' || log.channels !== 1 || log.format !== 's16le' ||
      log.sampleRate !== source.rate || log.pcm !== trace.pcm || log.sha256 !== sha256 || trace.sha256 !== sha256 ||
      pcm.length !== trace.pcmBytes || pcm.length !== log.pcmBytes) {
    throw new Error('Bukti PCM refleksi tidak sesuai dengan laporan.');
  }
  const first = pcm.indexOf(source.pcm);
  if (first < 0 || pcm.indexOf(source.pcm, first + 1) >= 0) return;
  const last = first + source.pcm.length;
  const frames = log.events.filter(({ event }) => event.type === 'output_audio').map(({ event }) => event.frame)
    .filter(({ pcmOffset, pcmLength }) => pcmOffset < last && pcmOffset + pcmLength > first);
  const bytesPerMs = 2 * log.sampleRate / 1_000;
  const contiguous = frames.every((frame, index) => frame.pcmLength === bytesPerMs * (frame.endMs - frame.startMs) &&
    (index === 0 || frames[index - 1].pcmOffset + frames[index - 1].pcmLength === frame.pcmOffset &&
      frames[index - 1].endMs === frame.startMs));
  if (!frames.length || !contiguous || frames[0].pcmOffset > first ||
      frames.at(-1).pcmOffset + frames.at(-1).pcmLength < last) return;
  const startMs = frames[0].startMs + (first - frames[0].pcmOffset) / bytesPerMs;
  return { sha256, startMs, endMs: startMs + source.pcm.length / bytesPerMs, matchedBytes: source.pcm.length };
}

async function verifyCase(directory, sample) {
  const { id, recording, backend, journal, playbackEvidence } = sample;
  const { turnId, generation } = backend ?? {};
  const base = { id, turnId, generation, captureMode: sample.capture?.captureMode };
  const playback = journal?.events.find(({ entry }) =>
    entry.type === 'playback' && entry.allowed && entry.turnId === turnId && entry.generation === generation);
  const proof = journal?.events.find(({ entry, sequence }) => sequence < playback?.sequence && turnId === entry.turnId &&
    entry.type === 'metric' && entry.metric?.stage === 'output_verify' && entry.metric.outcome === 'verified');
  if (!proof || journal.hasSequenceGaps) return { ...base, outcome: 'incomplete', reason: 'missing_gate_proof' };
  if (!wavName.test(recording ?? '')) return { ...base, outcome: 'incomplete', reason: 'no_browser_recording' };
  const target = (playbackEvidence ?? []).filter((row) => row.phase === 'target' &&
    row.turnId === turnId && row.generation === generation && row.httpStatus === 200);
  if (target.length !== 1 || !wavName.test(target[0].recording ?? '') || sample.playbackEvidenceOverflow) {
    return { ...base, outcome: 'incomplete', reason: 'missing_unique_delivery' };
  }
  const [served, capture] = await Promise.all([readFile(join(directory, target[0].recording)), readFile(join(directory, recording))]);
  const source = decodePilotWav(served);
  if (served.length !== target[0].bytes || source.sha256 !== target[0].sha256) {
    throw new Error('WAV pengiriman berbeda dari bukti yang dicatat.');
  }
  inspectPilotWav(capture, sample);
  const reflection = await findReflectedSource(directory, sample.providerTrace, source);
  if (!reflection) return { ...base, outcome: 'incomplete', reason: 'missing_unique_reflected_source' };
  const { cutoffMs, speechStartMs, speechEndMs, lastFrameEndMs } = proof.entry.metric.output ?? {};
  if (![cutoffMs, speechStartMs, speechEndMs, lastFrameEndMs].every(Number.isFinite) ||
      reflection.startMs < cutoffMs || reflection.startMs > speechStartMs ||
      reflection.endMs < speechEndMs || reflection.endMs > lastFrameEndMs) {
    return { ...base, outcome: 'incomplete', reason: 'reflected_source_outside_verified_turn', reflection };
  }
  return { ...base, browserRecording: recording, servedWav: target[0].recording, reflection,
    ...comparePilotWaveforms(served, capture) };
}

export async function verifyPilotWaveforms(report, directory) {
  const cases = [];
  for (const sample of report.samples) cases.push(await verifyCase(directory, sample));
  return { attempted: cases.length, matched: cases.filter(({ outcome }) => outcome === 'match').length, cases };
}

if (import.meta.main) {
  const [reportPath] = process.argv.slice(2);
  if (!reportPath) throw new Error('Gunakan node scripts/ceo-voice-pilot-waveform-review.mjs LAPORAN.json.');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  console.log(JSON.stringify(await verifyPilotWaveforms(report, dirname(reportPath)), null, 2));
}
