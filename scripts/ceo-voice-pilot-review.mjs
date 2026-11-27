import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import OpenAI, { toFile } from 'openai';
import { openBudget } from '../backend/modules/ai/budget.ts';
import { playbackChecklist, summarizePilot } from './ceo-voice-pilot-report.mjs';
import { inspectPilotWav } from './ceo-voice-pilot-wav.mjs';

const [reportPath, reviewsPath] = process.argv.slice(2);
const directory = resolve('.voice-pilot/luna-results');
if (!reportPath || dirname(resolve(reportPath)) !== directory) throw new Error('Pilih laporan pilot Luna dari direktori hasil lokal.');
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const reportName = basename(reportPath, '.json');

async function verifiedRecording(sample, review) {
  if (!/^[a-z0-9-]+\.wav$/.test(sample.recording)) throw new Error('Berkas audio pilot tidak valid.');
  const bytes = await readFile(join(directory, sample.recording));
  return { bytes, ...inspectPilotWav(bytes, sample, review) };
}

if (reviewsPath === '--checklist') {
  const output = join(directory, reportName + '-checklist.json');
  await writeFile(output, JSON.stringify(playbackChecklist(report.samples), null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ output }));
} else if (reviewsPath === '--validate-audio') {
  const validated = [];
  for (const sample of report.samples) {
    if (!sample.recording) continue;
    const { rate, seconds, sha256 } = await verifiedRecording(sample);
    validated.push({ id: sample.id, recording: sample.recording, rate, seconds, sha256 });
  }
  console.log(JSON.stringify({ validated, attempted: report.samples.length }, null, 2));
} else if (reviewsPath === '--transcribe') {
  const apiKey = process.env.OPENAI_API_KEY;
  const limit = Number(process.env.AI_OPENAI_BUDGET_USD ?? 5);
  if (!apiKey || !(limit > 0 && limit <= 5)) throw new Error('Kunci dan batas anggaran diperlukan.');
  const budget = openBudget(limit * 0.9);
  const client = new OpenAI({ apiKey, baseURL: 'https://api.openai.com/v1', maxRetries: 0, timeout: 20_000 });
  const transcripts = {};
  const output = join(directory, reportName + '-transcripts.json');
  for (const sample of report.samples) {
    if (!sample.recording) continue;
    const { bytes, seconds } = await verifiedRecording(sample);
    if (seconds > 40) throw new Error('Rekaman pilot melewati batas.');
    const estimated = Math.max(10, Math.ceil(seconds)) * 100;
    const settle = budget.reserve(estimated);
    try {
      const response = await client.audio.transcriptions.create({
        file: await toFile(bytes, 'pilot.wav'), model: 'whisper-1', language: 'id', temperature: 0,
        response_format: 'verbose_json', timestamp_granularities: ['word', 'segment'],
      });
      transcripts[sample.id] = { sourceSha256: sample.recordingSha256, text: response.text, words: response.words, segments: response.segments };
    } catch (error) {
      transcripts[sample.id] = { error: { name: error.name, status: error.status, code: error.code } };
    } finally {
      settle(estimated);
      await writeFile(output, JSON.stringify(transcripts, null, 2) + '\n', { mode: 0o600 });
    }
  }
  console.log(JSON.stringify({ transcribed: Object.keys(transcripts).length, output }));
} else {
  const reviews = reviewsPath ? JSON.parse(await readFile(reviewsPath, 'utf8')) : {};
  for (const sample of report.samples) {
    if (sample.playbackReviewRequired && sample.recording && reviews[sample.id]?.outcome === 'correct') {
      await verifiedRecording(sample, reviews[sample.id]);
    }
  }
  const assessed = summarizePilot(report.samples, reviews);
  await writeFile(join(directory, reportName + '-assessed.json'),
    JSON.stringify({ ...report, ...assessed }, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(assessed.summary));
}
