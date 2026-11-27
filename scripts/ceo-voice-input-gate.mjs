import { readFile } from 'node:fs/promises';
import { extractTranscriptEvidence } from './ceo-voice-transcript-evidence.mjs';

function words(text) {
  return text.normalize('NFC').toLocaleLowerCase('id-ID').trim()
    .replace(/[.!?]+$/u, '').trim().split(/\s+/u).join(' ');
}

export function judgeVoiceInput(sample, reference) {
  if (!reference?.text || !reference?.sha256) throw new Error(`Referensi WAV tidak tersedia untuk ${sample.id}.`);
  const used = sample.inputClips?.at(-1);
  if (used?.file !== reference.file || used?.sha256 !== reference.sha256 || used?.source !== reference.source) {
    return { id: sample.id, outcome: 'unverified', reason: 'different_input_clip' };
  }
  const evidence = extractTranscriptEvidence(sample);
  const base = { id: sample.id, reference: reference.text, rawTranscript: evidence.inputText,
    assembledTranscript: evidence.input?.text, backendOutcome: evidence.commentary?.result?.kind };
  if (sample.error || evidence.source !== 'provider_fragments' || sample.journal.hasSequenceGaps || !evidence.inputText) {
    return { ...base, outcome: 'unverified', reason: 'incomplete_provider_evidence' };
  }
  if (words(evidence.inputText) !== words(reference.text)) {
    return { ...base, outcome: 'failed', reason: 'provider_transcription_differs' };
  }
  if (evidence.inputAssembly !== 'exact' && words(evidence.input?.text ?? '') !== words(reference.text)) {
    return { ...base, outcome: 'failed', reason: 'application_transcription_differs' };
  }
  return { ...base, outcome: 'passed' };
}

export function summarizeVoiceInput(cases, total = cases.length) {
  const passed = cases.filter(({ outcome }) => outcome === 'passed').length;
  const failed = cases.filter(({ outcome }) => outcome === 'failed').length;
  return { passed, failed, unverified: total - passed - failed, total };
}

if (import.meta.main) {
  const [reportPath, manifestPath, ...ids] = process.argv.slice(2);
  if (!reportPath || !manifestPath || !ids.length || new Set(ids).size !== ids.length) {
    throw new Error('Gunakan node scripts/ceo-voice-input-gate.mjs LAPORAN.json MANIFEST.json ID_UJI...');
  }
  const report = JSON.parse(await readFile(reportPath));
  const manifest = JSON.parse(await readFile(manifestPath));
  const trials = Object.values(manifest).filter(Array.isArray).flat();
  const cases = ids.map((id) => {
    const sample = report.samples.find((row) => row.id === id);
    if (!sample) return { id, outcome: 'unverified', reason: 'not_run' };
    return judgeVoiceInput(sample, trials.find((trial) => trial.id === id)?.speech);
  });
  const summary = summarizeVoiceInput(cases);
  console.log(JSON.stringify({ ...summary, cases }, null, 2));
  if (summary.passed !== summary.total) process.exitCode = 1;
}
