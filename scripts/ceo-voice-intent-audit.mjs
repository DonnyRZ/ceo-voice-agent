import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import OpenAI from 'openai';
import { embeddingMicros, openBudget } from '../backend/modules/ai/budget.ts';
import { parseCeoIntent } from '../backend/modules/ai/retrieval/intent.ts';

const labels = ['pic', 'status', 'updated_at', 'summary', 'history', 'unsupported'];
const [profilesPath, evaluationPath, reportPath, policyPath, calibrationPath] = process.argv.slice(2);
if (!profilesPath || !evaluationPath || !reportPath) {
  throw new Error('Berikan berkas profil, evaluasi, dan tujuan laporan.');
}

const profiles = JSON.parse(await readFile(profilesPath, 'utf8'));
const evaluation = JSON.parse(await readFile(evaluationPath, 'utf8'));
if (Boolean(policyPath) !== Boolean(calibrationPath)) throw new Error('Profil kebijakan dan set kalibrasi harus berpasangan.');
const policy = policyPath ? JSON.parse(await readFile(policyPath, 'utf8')) : [];
const calibration = calibrationPath ? JSON.parse(await readFile(calibrationPath, 'utf8')) : [];
for (const record of [...profiles, ...evaluation, ...calibration]) {
  if (!labels.includes(record.expected) || typeof record.text !== 'string' || !record.text.trim()) {
    throw new Error('Profil atau evaluasi tidak memiliki label dan pertanyaan yang sah.');
  }
}
if (labels.some((label) => !profiles.some((reference) => reference.expected === label))) {
  throw new Error('Setiap jenis permintaan memerlukan paling sedikit satu profil.');
}
if (policy.some(({ expected, text }) => !['read', 'exclude'].includes(expected) || typeof text !== 'string' || !text.trim())
  || (policyPath && !['read', 'exclude'].every((label) => policy.some(({ expected }) => label === expected)))) {
  throw new Error('Profil kebijakan harus berisi permintaan baca dan permintaan di luar cakupan.');
}
const seen = new Set([...profiles, ...policy, ...calibration].map(({ text }) => text));
if (evaluation.some(({ text }) => seen.has(text))) {
  throw new Error('Pertanyaan evaluasi harus terpisah dari profil dan kalibrasi.');
}
if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_EMBEDDING_MODEL) {
  throw new Error('Model dan kredensial embedding belum dikonfigurasi.');
}
const budgetUsd = Number(process.env.AI_OPENAI_BUDGET_USD ?? 5);
if (!(budgetUsd > 0 && budgetUsd <= 5)) throw new Error('Anggaran pilot tidak sah.');
const budget = openBudget(budgetUsd * 0.1, '.voice-pilot/embeddings-budget.json');
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'https://api.openai.com/v1',
  maxRetries: 0,
  timeout: 8_000,
  logLevel: 'off',
});

async function getEmbeddings(texts) {
  const maximumTokens = texts.reduce((sum, text) => sum + Buffer.byteLength(text, 'utf8') + 8, 0);
  const settle = budget.reserve(embeddingMicros(maximumTokens));
  const start = performance.now();
  const result = await client.embeddings.create({
    model: process.env.OPENAI_EMBEDDING_MODEL, dimensions: 1536, input: texts,
  });
  const elapsedMs = Math.round(performance.now() - start);
  settle(embeddingMicros(result.usage.total_tokens));
  const vectors = result.data.toSorted((left, right) => left.index - right.index).map((item) => unit(item.embedding));
  if (vectors.length !== texts.length) throw new Error('Jumlah embedding tidak sesuai.');
  return { vectors, elapsedMs };
}

function unit(vector) {
  if (vector.length !== 1536 || !vector.every(Number.isFinite)) throw new Error('Embedding tidak sah.');
  const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (length === 0) throw new Error('Embedding kosong.');
  return vector.map((value) => value / length);
}

function centroid(vectors) {
  return unit(vectors[0].map((_, dimension) => vectors.reduce((sum, vector) => sum + vector[dimension], 0)));
}

function cosine(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function buildCenters(records, vectors, subgroupLabel) {
  const groups = new Map();
  records.forEach(({ expected: label, group }, index) => {
    const key = label === subgroupLabel && group ? label + '/' + group : label;
    const members = groups.get(key) ?? { label, vectors: [] };
    members.vectors.push(vectors[index]);
    groups.set(key, members);
  });
  return [...groups.values()].map(({ label, vectors: members }) => ({ label, vector: centroid(members) }));
}

function rankLabels(vector, centers) {
  const scores = new Map();
  for (const center of centers) {
    scores.set(center.label, Math.max(scores.get(center.label) ?? -1, cosine(vector, center.vector)));
  }
  return [...scores].map(([label, score]) => ({ label, score })).sort((left, right) => right.score - left.score);
}

function classify(vector, centers) {
  const ranking = rankLabels(vector, centers);
  const lead = ranking[0].score - ranking[1].score;
  return {
    semantic: ranking[0].label,
    guarded: lead >= 0.03 ? ranking[0].label : 'clarify',
    lead: Number(lead.toFixed(4)),
  };
}

function readEvidence(vector, policyCenters) {
  const scores = new Map(rankLabels(vector, policyCenters).map(({ label, score }) => [label, score]));
  return scores.get('read') - scores.get('exclude');
}

function calibrate(centers, policyCenters, records, vectors) {
  const misroutes = records.flatMap(({ expected }, index) => {
    const vector = vectors[index];
    const { guarded } = classify(vector, centers);
    return expected === 'unsupported' && !['clarify', 'unsupported'].includes(guarded)
      ? [readEvidence(vector, policyCenters)] : [];
  });
  // Reserve automatic reads for stronger evidence than every observed unsupported route.
  return { threshold: Math.max(0, ...misroutes), developmentMisroutes: misroutes.length };
}

function baseline(text) {
  const parsed = parseCeoIntent(text, [], new Date('2026-11-26T00:00:00Z'));
  if (parsed.kind !== 'request') return parsed.kind;
  return parsed.request.focusUpdatedAt ? 'updated_at' : parsed.request.intent;
}

function count(results, field) {
  return {
    correct: results.filter((result) => result[field] === result.expected).length,
    incorrect: results.filter((result) => result[field] !== result.expected && result[field] !== 'clarify').length,
    clarify: results.filter((result) => result[field] === 'clarify').length,
    unsupportedMisrouted: results.filter((result) =>
      result.expected === 'unsupported' && !['unsupported', 'clarify'].includes(result[field])).length,
  };
}

try {
  const rows = [...profiles, ...policy, ...calibration, ...evaluation];
  const { vectors, elapsedMs } = await getEmbeddings(rows.map(({ text }) => text));
  const centers = buildCenters(profiles, vectors, 'unsupported');
  const policyCenters = buildCenters(policy, vectors.slice(profiles.length), 'exclude');
  const calibrationVectors = vectors.slice(profiles.length + policy.length);
  const guard = policy.length ? calibrate(centers, policyCenters, calibration, calibrationVectors) : null;
  const results = evaluation.map(({ text, expected }, index) => {
    const vector = calibrationVectors[calibration.length + index];
    const result = { text, expected, baseline: baseline(text), ...classify(vector, centers) };
    if (!guard) return result;
    const evidence = readEvidence(vector, policyCenters);
    const operation = result.guarded;
    const policyGuarded = !['unsupported', 'clarify'].includes(operation) && evidence <= guard.threshold
      ? 'clarify' : operation;
    return { ...result, policyGuarded, evidence: Number(evidence.toFixed(4)) };
  });
  const singleEmbeddingMs = [];
  for (const { text } of evaluation.slice(0, 4)) {
    singleEmbeddingMs.push((await getEmbeddings([text])).elapsedMs);
  }
  const report = {
    model: process.env.OPENAI_EMBEDDING_MODEL,
    profiles: profiles.length, samples: results.length, batchMs: elapsedMs, singleEmbeddingMs,
    baseline: count(results, 'baseline'), semantic: count(results, 'semantic'), guarded: count(results, 'guarded'),
    ...(guard ? { policy: { ...guard, profiles: policy.length, calibration: calibration.length },
      policyGuarded: count(results, 'policyGuarded') } : {}),
    results,
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  const { results: _, ...summary } = report;
  console.log(JSON.stringify(summary));
} catch (error) {
  console.error('Eksperimen embedding gagal.', {
    type: error instanceof Error ? error.name : 'Error',
    status: error instanceof OpenAI.APIError ? error.status : undefined,
  });
  process.exitCode = 1;
}
