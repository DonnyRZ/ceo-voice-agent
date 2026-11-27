import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { judgeVoiceInput, summarizeVoiceInput } from './ceo-voice-input-gate.mjs';

const reference = { file: 'original.wav', sha256: 'f'.repeat(64), source: 'synthetic-espeak', text: 'Cek proyek Taman Jingga.' };

function sample(providerText, assembled = providerText) {
  return { id: 'sample', mode: 'new', inputClips: [reference], journal: {
    hasSequenceGaps: false,
    transcriptEvents: [{ sequence: 1,
      fragment: { eventId: 'input', role: 'user', text: providerText, startMs: 100, endMs: 800 } }],
    events: [
      { sequence: 2, entry: { type: 'turn_input', turnId: 't', userEndMs: 800, text: assembled } },
      { sequence: 3, entry: { type: 'commentary_sent', turnId: 't', result: { kind: 'no_match' } } },
    ],
  } };
}

test('a safe lookup response cannot count as a correct transcription', () => {
  const result = judgeVoiceInput(sample('Cek proyek taman singa.'), reference);
  assert.equal(result.backendOutcome, 'no_match');
  assert.equal(result.outcome, 'failed');
  assert.equal(result.reason, 'provider_transcription_differs');
});

test('matches lexical input independent of case and terminal punctuation', () => {
  assert.equal(judgeVoiceInput(sample('Cek proyek taman jingga?'), reference).outcome, 'passed');
});

test('withholds success when audio provenance or input assembly differs', () => {
  const actual = sample(reference.text);
  actual.inputClips = [{ ...reference, sha256: 'e'.repeat(64) }];
  assert.equal(judgeVoiceInput(actual, reference).reason, 'different_input_clip');
  const clipped = sample(reference.text, 'Cek proyek Taman');
  assert.equal(judgeVoiceInput(clipped, reference).reason, 'application_transcription_differs');
});

test('counts rejected and unrecorded trials without increasing the score', () => {
  const passed = judgeVoiceInput(sample(reference.text), reference);
  const failed = judgeVoiceInput(sample('Cek proyek Taman Singa.'), reference);
  assert.deepEqual(summarizeVoiceInput([passed, failed], 3), { passed: 1, failed: 1, unverified: 1, total: 3 });
});
