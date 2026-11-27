import { readFile } from 'node:fs/promises';
import { extractTranscriptEvidence, normalizedText } from './ceo-voice-transcript-evidence.mjs';

function readoutText(text) {
  return normalizedText(text).replace(/(?<!\.)\.$/u, '');
}

function contains(actual, expected) {
  if (expected === null || typeof expected !== 'object') return Object.is(actual, expected);
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.every((element, index) => contains(actual[index], element));
  }
  return actual !== null && typeof actual === 'object'
    && Object.entries(expected).every(([key, value]) => contains(actual[key], value));
}

function backendReview(expected, evidence) {
  const actual = evidence.commentary?.result;
  if (expected.kind === 'revoked') {
    const revoked = evidence.revoked && !actual;
    return { outcome: revoked ? 'match' : 'mismatch', reason: revoked ? 'session_revoked' : 'revocation_unverified', actual };
  }
  if (!actual) return { outcome: 'missing', reason: 'no_commentary_for_target_turn' };
  const expectedResult = { kind: expected.kind, ...(expected.facts ? { facts: expected.facts } : {}) };
  if (contains(actual, expectedResult) && (!expected.candidateName || actual.text?.includes(expected.candidateName))) {
    return { outcome: 'match', actual };
  }
  const reason = actual.kind === 'unavailable' ? evidence.retrieval?.outcome ?? 'unavailable'
    : actual.kind !== expected.kind ? 'result_kind_mismatch' : 'facts_or_candidate_mismatch';
  return { outcome: 'mismatch', reason, actual };
}

function generatedReview(sample, evidence, review) {
  if (review) {
    if (!['correct', 'incorrect', 'incomplete'].includes(review.outcome) || typeof review.reason !== 'string' || !review.reason.trim()) {
      throw new Error(`Label transkrip tidak valid untuk ${sample.id}.`);
    }
    const quote = typeof review.evidence === 'string' ? normalizedText(review.evidence) : '';
    if ((!quote && review.outcome !== 'incomplete') ||
        (quote && !normalizedText(evidence.outputText).includes(quote))) {
      throw new Error(`Kutipan peninjauan tidak ditemukan dalam transkrip ${sample.id}.`);
    }
    if (review.outcome === 'correct' && (evidence.uncertainty || evidence.source === 'missing')) {
      throw new Error(`Batas transkrip belum terverifikasi pada ${sample.id}.`);
    }
    const { outcome, reason, evidence: reviewedQuote, note } = review;
    return { outcome, reason, evidence: reviewedQuote, note, method: 'reviewed_provider_transcript' };
  }
  if (evidence.uncertainty) return { outcome: 'incomplete', reason: evidence.uncertainty };
  if (!evidence.outputText) return { outcome: 'incomplete', reason: 'missing_generated_text' };
  if (sample.expect.kind === 'revoked') return { outcome: 'incorrect', reason: 'generated_text_during_revocation' };
  if (evidence.commentary?.text &&
      (Number.isSafeInteger(evidence.commentarySequence) || Number.isSafeInteger(evidence.cutoffMs))
      && readoutText(evidence.commentary.text) === readoutText(evidence.outputText) && !evidence.beforeCommentary) {
    return { outcome: 'exact_readout', method: 'literal_backend_readout' };
  }
  return {
    outcome: 'needs_review',
    reason: evidence.beforeCommentary ? 'contains_text_before_commentary'
      : !evidence.commentary ? 'no_target_backend_readout'
        : evidence.cutoffMs === undefined && evidence.commentarySequence === undefined
          ? 'response_boundary_missing' : 'different_from_backend_readout',
  };
}

function assess(sample, review) {
  const evidence = extractTranscriptEvidence(sample);
  const backend = backendReview(sample.expect, evidence);
  const generated = generatedReview(sample, evidence, review);
  let outcome;
  if (generated.outcome === 'incorrect') outcome = 'incorrect';
  else if (sample.error || evidence.source === 'missing' || evidence.uncertainty || backend.outcome === 'missing') outcome = 'incomplete';
  else if (backend.outcome === 'mismatch') outcome = 'incorrect';
  else if (sample.expect.kind === 'revoked' && !evidence.outputText) outcome = 'guard_verified';
  else if (generated.outcome === 'correct' || generated.outcome === 'exact_readout') outcome = 'correct';
  else outcome = generated.outcome;

  return {
    id: sample.id, mode: sample.mode, category: sample.category, expected: sample.expect, outcome, error: sample.error,
    sessionCondition: sample.sessionCondition,
    backend: { ...backend, turnId: evidence.turnId, commentary: evidence.commentary?.text },
    generated: {
      ...generated, source: evidence.source, text: evidence.outputText, fragments: evidence.lines,
      beforeCutoff: evidence.beforeCutoff, cutoffMs: evidence.cutoffMs, cutoffSource: evidence.cutoffSource,
      beforeCommentary: evidence.beforeCommentary, commentarySequence: evidence.commentarySequence,
      uncertainty: evidence.uncertainty, hasAssistantTranscript: evidence.hasAssistantTranscript,
    },
    input: { providerText: evidence.inputText, referenceText: evidence.referenceText, comparison: evidence.inputComparison,
      assembly: evidence.inputAssembly, consumed: evidence.input?.text,
      correction: evidence.inputCorrection, providerFragmentsAfterAssembledEnd: evidence.followingProviderInput,
      startMs: evidence.startMs, providerSpeechEndMs: evidence.input?.userEndMs },
  };
}

function counts(rows, get) {
  const totals = new Map();
  for (const row of rows) {
    const key = get(row);
    if (key) totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  return Object.fromEntries(totals);
}

function totals(cases) {
  const speech = cases.filter(({ expected }) => expected.kind !== 'revoked');
  return {
    attempted: cases.length,
    expectedSpeech: speech.length,
    withSessionAssistantTranscript: speech.filter(({ generated }) => generated.hasAssistantTranscript).length,
    withProviderOutput: speech.filter(({ generated }) => generated.text).length,
    withUnambiguousOutput: speech.filter(({ generated }) => generated.text && !generated.uncertainty).length,
    beforeCutoff: speech.filter(({ generated }) => generated.beforeCutoff).length,
    beforeCommentary: speech.filter(({ generated }) => generated.beforeCommentary).length,
    outcomes: counts(cases, ({ outcome }) => outcome),
    backendOutcomes: counts(cases, ({ backend }) => backend.outcome),
    generatedOutcomes: counts(cases, ({ generated }) => generated.outcome),
    backendReasons: counts(cases, ({ backend }) => backend.reason),
    generatedReasons: counts(cases, ({ generated }) => generated.reason),
    inputComparisons: counts(cases, ({ input }) => input.comparison),
    inputAssembly: counts(cases, ({ input }) => input.assembly),
    withProviderFragmentsAfterAssembledEnd: cases.filter(({ input }) => input.providerFragmentsAfterAssembledEnd?.length).length,
    corrections: counts(cases, ({ input }) => {
      if (!input.correction) return;
      if (input.correction.assembledLiteralSuffix) return 'assembled_literal_suffix';
      if (input.correction.providerLiteralSuffix) return 'only_provider_literal_suffix';
      return 'reference_suffix_unverified';
    }),
    sessionConditions: counts(cases, ({ sessionCondition }) =>
      !sessionCondition ? 'unrecorded' : sessionCondition.matches ? 'matched' : 'mismatch'),
  };
}

export function reviewTranscriptPilot(report, reviews = {}) {
  if (!Array.isArray(report?.samples) || report.samples.some((sample) =>
    typeof sample?.id !== 'string' || typeof sample.expect?.kind !== 'string')) {
    throw new Error('Laporan pilot atau kebenaran fixture tidak valid.');
  }
  const ids = new Set(report.samples.map(({ id }) => id));
  if (!reviews || typeof reviews !== 'object' || Array.isArray(reviews) || ids.size !== report.samples.length
      || Object.keys(reviews).some((id) => !ids.has(id))) {
    throw new Error('ID uji duplikat atau label peninjauan tidak sesuai laporan.');
  }
  const cases = report.samples.map((sample) => assess(sample, Object.hasOwn(reviews, sample.id) ? reviews[sample.id] : undefined));
  const grouped = (key) => Object.fromEntries([...new Set(cases.map((item) => item[key]).filter(Boolean))]
    .map((value) => [value, totals(cases.filter((item) => item[key] === value))]));
  return {
    evidence: 'provider-transcript-only',
    phase: report.phase,
    tag: report.tag,
    manifestSha256: report.manifestSha256,
    summary: {
      ...totals(cases),
      planned: report.planned,
      notRun: Number.isSafeInteger(report.planned) ? Math.max(0, report.planned - cases.length) : undefined,
      byMode: grouped('mode'),
      byCategory: grouped('category'),
    },
    cases,
  };
}

if (import.meta.main) {
  const [reportPath, labelsPath] = process.argv.slice(2);
  if (!reportPath) throw new Error('Gunakan node scripts/ceo-voice-transcript-review.mjs LAPORAN.json [LABEL.json].');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const labels = labelsPath ? JSON.parse(await readFile(labelsPath, 'utf8')) : undefined;
  console.log(JSON.stringify(reviewTranscriptPilot(report, labels), null, 2));
}
