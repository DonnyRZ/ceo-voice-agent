import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewTranscriptPilot } from './ceo-voice-transcript-review.mjs';

const id = 'task';
const expected = { kind: 'facts', facts: { intent: 'status', entity: { id }, status: 'done' } };
const actual = { ...expected, text: 'Uji notifikasi selesai.' };
const heardQuestion = 'Tugas Uji notifikasi sudah beres?';
const delegated = (turnId) => ({ type: 'metric', turnId, metric: { type: 'delegation', action: 'started' } });
const input = (turnId, text = heardQuestion) => ({
  type: 'turn_input', turnId, text, userEndMs: 950, delegationOffsetMs: 980,
});
const commentary = (turnId, result = actual) => ({ type: 'commentary_sent', turnId, result, text: result.text });
const ack = (turnId) => ({ type: 'commentary_ack', turnId, accepted: true, endMs: 1_200 });
const user = { role: 'user', text: heardQuestion, startMs: 630, endMs: 950 };
const answer = { role: 'assistant', text: actual.text, startMs: 1_250, endMs: 1_550 };

function sample(options = {}) {
  const {
    mode = 'new', expect = expected, events = [delegated('current'), input('current'), commentary('current'), ack('current')],
    fragments = [user, answer], archived = false, hasSequenceGaps = false,
  } = options;
  const transcript = archived
    ? { transcript: fragments }
    : { transcriptEvents: fragments.map(({ sequence, ...fragment }, index) => ({ sequence: sequence ?? index + 30, fragment })) };
  return {
    id: 'example', mode, expect, category: 'routine', transcriptExpected: { text: heardQuestion },
    journal: { ...transcript, hasSequenceGaps, events: events.map((entry, index) => ({ sequence: index + 10, entry })) },
  };
}

const evaluate = (item, review) => reviewTranscriptPilot({ planned: 1, samples: [item] }, review).cases[0];

test('literal transcript and correct SQL facts are sufficient independently of playback', () => {
  const item = sample();
  const result = evaluate({ ...item, backend: { matches: false, released: false }, capture: { firstAudibleMs: null } });
  assert.equal(result.outcome, 'correct');
  assert.equal(result.backend.outcome, 'match');
  assert.equal(result.generated.outcome, 'exact_readout');
  assert.equal(result.generated.cutoffSource, 'commentary_ack');
  assert.equal(result.input.comparison, 'exact');
});

test('an exact rendering of incorrect backend facts remains incorrect', () => {
  const wrong = { ...expected, text: 'Uji notifikasi masih pending.', facts: { ...expected.facts, status: 'pending' } };
  const result = evaluate(sample({
    events: [delegated('current'), input('current'), commentary('current', wrong), ack('current')],
    fragments: [user, { ...answer, text: wrong.text }],
  }));
  assert.equal(result.generated.outcome, 'exact_readout');
  assert.equal(result.backend.reason, 'facts_or_candidate_mismatch');
  assert.equal(result.outcome, 'incorrect');
});

test('omitting the final period preserves facts while an ellipsis or question stays distinct', () => {
  const plain = actual.text.slice(0, -1);
  assert.equal(evaluate(sample({ fragments: [user, { ...answer, text: plain }] })).outcome, 'correct');
  for (const suffix of ['...', '?']) {
    assert.equal(evaluate(sample({ fragments: [user, { ...answer, text: plain + suffix }] })).outcome, 'needs_review');
  }
});

test('an unsupported statement before the correct readout requires review', () => {
  const result = evaluate(sample({ fragments: [user, {
    role: 'assistant', sequence: 8, startMs: 970, endMs: 1_110, text: 'Uji notifikasi masih pending. ',
  }, answer] }));
  assert.equal(result.backend.outcome, 'match');
  assert.equal(result.generated.beforeCutoff, true);
  assert.equal(result.generated.reason, 'contains_text_before_commentary');
  assert.equal(result.outcome, 'needs_review');
});

test('a literal readout with provider offset before the estimated ACK is valid after the commentary was sent', () => {
  const result = evaluate(sample({ fragments: [user, { ...answer, startMs: 1_150 }] }));
  assert.equal(result.generated.beforeCutoff, true);
  assert.equal(result.generated.beforeCommentary, false);
  assert.equal(result.outcome, 'correct');
});

test('a false fact alongside the expected readout is never an exact match', () => {
  const result = evaluate(sample({ fragments: [user, { ...answer, text: 'Tidak ditemukan. ' + actual.text }] }));
  assert.equal(result.generated.reason, 'different_from_backend_readout');
  assert.equal(result.outcome, 'needs_review');
});

test('wrong generated content is independently rated against fixture facts', () => {
  const wrong = 'Tugasnya masih pending.';
  const item = sample({ fragments: [user, { ...answer, text: wrong }] });
  assert.equal(evaluate(item).outcome, 'needs_review');
  const review = { outcome: 'incorrect', reason: 'wrong_status', evidence: wrong };
  const reviewed = evaluate(item, { example: review });
  assert.equal(reviewed.backend.outcome, 'match');
  assert.equal(reviewed.outcome, 'incorrect');
  assert.throws(() => evaluate(item, { example: { ...review, evidence: 'Uji notifikasi selesai.' } }), /Kutipan/);
});

test('archived warmup output is excluded using the target input anchor', () => {
  const result = evaluate(sample({ mode: 'standby', archived: true, fragments: [
    { role: 'user', text: 'Pertanyaan awal?', startMs: 20, endMs: 180 },
    { role: 'assistant', text: 'Jawaban dari sesi pemanasan.', startMs: 200, endMs: 500 },
    user, answer,
  ] }));
  assert.equal(result.outcome, 'correct');
  assert.equal(result.generated.text, actual.text);
  assert.equal(result.generated.source, 'archived_provider_groups');
});

test('archived warmup without an attributable target remains incomplete', () => {
  const item = sample({ mode: 'active', archived: true, events: [delegated('current')], fragments: [user, answer] });
  const result = evaluate(item);
  assert.equal(result.outcome, 'incomplete');
  assert.equal(result.generated.text, '');
  assert.equal(result.generated.uncertainty, 'setup_boundary_missing');
  assert.equal(result.generated.hasAssistantTranscript, true);
  const report = reviewTranscriptPilot({ planned: 2, samples: [item] });
  assert.equal(report.summary.withSessionAssistantTranscript, 1);
  assert.equal(report.summary.withProviderOutput, 0);
  assert.equal(report.summary.notRun, 1);
});

test('new unserved delegation cannot borrow a previous turn’s backend answer', () => {
  const result = evaluate(sample({
    events: [delegated('old'), input('old'), commentary('old'), ack('old'), delegated('new')],
  }));
  assert.equal(result.backend.turnId, 'new');
  assert.equal(result.backend.reason, 'no_commentary_for_target_turn');
  assert.equal(result.outcome, 'incomplete');
});

test('the revocation guard fails if provider output exists even if nothing was played', () => {
  const expect = { kind: 'revoked' };
  const events = [{ type: 'metric', metric: { type: 'session', reason: 'revoked' } }];
  const guard = evaluate(sample({ expect, events, fragments: [user] }));
  assert.equal(guard.outcome, 'guard_verified');
  const leak = evaluate(sample({ expect, events }));
  assert.equal(leak.outcome, 'incorrect');
  assert.equal(leak.generated.reason, 'generated_text_during_revocation');
});

test('sequence gaps prevent automatic or reviewed correct attribution', () => {
  const item = sample({ hasSequenceGaps: true });
  assert.equal(evaluate(item).outcome, 'incomplete');
  assert.throws(() => evaluate(item, { example: {
    outcome: 'correct', reason: 'verified', evidence: actual.text,
  } }), /Batas transkrip/);
});

test('provider fragments are ordered by offset, preserving spaces and ignoring duplicate event IDs', () => {
  const tail = { ...answer, startMs: 1_500, text: ' selesai.', eventId: 'tail' };
  const head = { ...answer, endMs: 1_497, text: 'Uji notifikasi', eventId: 'head' };
  const result = evaluate(sample({ fragments: [user, tail, head, tail] }));
  assert.equal(result.outcome, 'correct');
  assert.equal(result.generated.text, actual.text);
});

test('provider tail omitted by assembly is exposed separately from generated correctness', () => {
  const correction = 'Maksudnya yang di Finance.';
  const result = evaluate({
    ...sample({ fragments: [user, { role: 'user', text: ' ' + correction, startMs: 960, endMs: 1_150 }, answer] }),
    transcriptExpected: { text: heardQuestion, interruptionText: correction },
  });
  assert.equal(result.input.assembly, 'provider_text_continues_after_assembly');
  assert.equal(result.input.consumed, heardQuestion);
  assert.equal(result.input.comparison, 'exact');
  assert.equal(result.input.correction.providerLiteralSuffix, true);
  assert.equal(result.input.correction.assembledLiteralSuffix, false);
  assert.equal(result.input.providerFragmentsAfterAssembledEnd[0].startMs, 960);
  assert.equal(result.outcome, 'correct');
});
