function matches(actual, expected) {
  if (expected === null || typeof expected !== 'object') return Object.is(actual, expected);
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.every((value, index) => matches(actual[index], value));
  }
  return actual !== null && typeof actual === 'object'
    && Object.entries(expected).every(([key, value]) => matches(actual[key], value));
}

export function compareBackend(expected, journal) {
  const entries = journal?.events.map(({ entry }) => entry) ?? [];
  const commentaryIndex = entries.findLastIndex(({ type }) => type === 'commentary_sent');
  const latest = entries[commentaryIndex];
  const played = entries.filter(({ type }) => type === 'playback');
  const revoked = entries.some(({ metric }) => metric?.type === 'session' && metric.reason === 'revoked');
  if (expected.kind === 'revoked') return { matches: revoked && !played.some(({ allowed }) => allowed), revoked };
  const turnId = latest?.turnId ?? entries.findLast((entry) => entry.type === 'turn_input')?.turnId;
  const stages = entries.filter((entry) => entry.type === 'metric' && entry.turnId && entry.turnId === turnId);
  const { kind, facts } = expected;
  const expectedResult = facts ? { kind, facts } : { kind };
  const releaseIndex = entries.findIndex((entry, index) => index > commentaryIndex &&
    entry.type === 'playback' && entry.turnId === turnId && entry.allowed);
  const verifierIndex = entries.findIndex((entry, index) => index > commentaryIndex &&
    entry.type === 'metric' && entry.turnId === turnId &&
    entry.metric?.stage === 'output_verify' && entry.metric.outcome === 'verified');
  const resultMatches = matches(latest?.result, expectedResult) &&
    (!expected.candidateName || Boolean(latest?.result?.text?.includes(expected.candidateName)));
  const released = releaseIndex >= 0;
  return { matches: released && resultMatches, resultMatches, turnId, generation: entries[releaseIndex]?.generation, stages,
    released, verifiedBeforeRelease: verifierIndex >= 0 && releaseIndex > verifierIndex };
}

export function playbackChecklist(samples) {
  return Object.fromEntries(samples.filter(({ recording }) => recording).map((sample) => [sample.id, {
    recording: sample.recording,
    sourceSha256: sample.recordingSha256,
    expected: sample.expect,
    outcome: 'pending',
    method: 'listening',
    firstFactEndSeconds: null,
    answerEndSeconds: null,
    checks: { correctEntityAndValue: false, noStaleOrExtraSpeech: false, completeAnswer: false },
    note: '',
  }]));
}

export function verifyPlayback(sample, review) {
  if (sample.error) return { outcome: 'incomplete', note: sample.error };
  if (sample.expect.kind === 'revoked' && sample.backend?.matches && !sample.recording)
    return { outcome: 'guard_verified', note: 'Jurnal mengonfirmasi pencabutan akses dan izin putar tertahan.' };
  if (!sample.backend?.matches) return { outcome: 'incorrect', note: 'Hasil backend tidak cocok dengan fixture.' };
  if (!sample.recording) return { outcome: 'incomplete', note: 'Rekaman setelah kontrol pemutaran tidak tersedia.' };
  if (!review || review.outcome === 'pending') return undefined;
  if (review.outcome !== 'correct') return { outcome: review.outcome, note: review.note };
  if (sample.playbackReviewRequired) {
    const checks = review.checks;
    if (!sample.recordingSha256 || review.sourceSha256 !== sample.recordingSha256 ||
        !['listening', 'independent-audio-transcription'].includes(review.method) ||
        !['browser-tab-audio', 'isolated-pulse-monitor'].includes(sample.capture?.captureMode) ||
        !checks?.correctEntityAndValue || !checks.noStaleOrExtraSpeech || !checks.completeAnswer) {
      return { outcome: 'incomplete', note: 'Bukti audit audio independen belum lengkap.' };
    }
    if (!sample.backend.verifiedBeforeRelease) {
      return { outcome: 'incomplete', note: 'Jurnal belum mengonfirmasi verifikasi audio sebelum izin putar.' };
    }
  }
  const {
    sampleRate, recordingStartFrame, firstAudibleFrame, lastAudibleFrame,
    speechStartFrame, speechEndFrame, interruptionEndFrame,
  } = sample.capture ?? {};
  if (!(sampleRate > 0) || ![recordingStartFrame, firstAudibleFrame, lastAudibleFrame, speechStartFrame, speechEndFrame].every(Number.isFinite)) {
    return { outcome: 'incomplete', note: 'Rekaman setelah kontrol pemutaran tidak tersedia.' };
  }
  const { firstFactEndSeconds, answerEndSeconds } = review;
  if (!Number.isFinite(firstFactEndSeconds) || !Number.isFinite(answerEndSeconds) || firstFactEndSeconds > answerEndSeconds) {
    throw new Error(`Stempel waktu peninjauan tidak lengkap pada ${sample.id}.`);
  }
  const firstFact = recordingStartFrame + Math.round(firstFactEndSeconds * sampleRate);
  const answerEnd = recordingStartFrame + Math.round(answerEndSeconds * sampleRate);
  if (firstFact < firstAudibleFrame || answerEnd > lastAudibleFrame + sampleRate * 0.05) {
    throw new Error(`Stempel waktu peninjauan di luar audio yang diputar pada ${sample.id}.`);
  }
  if (sample.playbackReviewRequired && firstFact < (interruptionEndFrame ?? speechEndFrame)) {
    return { outcome: 'incorrect', note: 'Fakta yang dinilai selesai sebelum akhir pertanyaan yang menjadi acuannya.' };
  }
  const ms = (frames) => Math.round(frames * 1000 / sampleRate);
  return {
    outcome: 'correct', note: review.note,
    speechStartToFirstFactMs: ms(firstFact - speechStartFrame),
    speechEndToFirstFactMs: ms(firstFact - (interruptionEndFrame ?? speechEndFrame)),
    speechStartToAnswerEndMs: ms(answerEnd - speechStartFrame),
    speechEndToAnswerEndMs: ms(answerEnd - (interruptionEndFrame ?? speechEndFrame)),
  };
}

function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = (q) => sorted[Math.ceil(q * sorted.length) - 1] ?? null;
  return { count: sorted.length, p50: at(0.5), p95: at(0.95) };
}

export function summarizePilot(samples, reviews = {}) {
  const withReview = samples.map((sample) => ({ ...sample, assessment: verifyPlayback(sample, reviews[sample.id]) }));
  const routine = withReview.filter(({ category }) => category === 'routine');
  const measurements = samples.flatMap(({ journal }) =>
    (journal?.events ?? []).flatMap(({ entry }) => entry.type === 'metric' && entry.turnId ? [entry.metric] : []));
  const stages = Object.fromEntries(
    ['input_to_delegation', 'division_lookup', 'intent_inference', 'scope_recheck', 'candidate_lookup', 'semantic_lookup', 'facts_lookup',
      'commentary_ack', 'output_verify', 'delegation_to_playback_allowed'].map((stage) => {
      const records = measurements.filter((metric) => metric.stage === stage);
      return [stage, {
        observedMs: distribution(records.filter(({ outcome }) => ['observed', 'accepted', 'verified'].includes(outcome))
          .map(({ durationMs }) => durationMs)),
        timeouts: records.filter(({ outcome }) => outcome === 'timeout').length,
        errors: records.filter(({ outcome }) => ['error', 'rejected', 'mismatch', 'boundary', 'overflow'].includes(outcome)).length,
        discarded: records.filter(({ outcome }) => outcome === 'discarded' || outcome === 'aborted').length,
      }];
    }),
  );
  const groups = Object.fromEntries(['new', 'active', 'standby'].map((mode) => {
    const cases = withReview.filter((sample) => sample.mode === mode);
    const factCases = cases.filter((sample) => sample.expect.kind === 'facts');
    return [mode, {
      attempted: cases.length,
      audioBeforeSpeechEnd: cases.filter(({ capture }) => capture?.firstAudibleMs < 0).length,
      startToAudioMs: distribution(cases.filter(({ capture }) => capture?.firstAudibleMs >= 0)
        .map(({ capture }) => capture.firstAudibleFromSpeechStartMs)),
      endToAudioMs: distribution(cases.map(({ capture }) => capture?.firstAudibleMs).filter((duration) => duration >= 0)),
      endToCorrectFactMs: distribution(factCases.map(({ assessment }) => assessment?.speechEndToFirstFactMs)),
      startToCorrectFactMs: distribution(factCases.map(({ assessment }) => assessment?.speechStartToFirstFactMs)),
      startToAnswerEndMs: distribution(factCases.map(({ assessment }) => assessment?.speechStartToAnswerEndMs)),
    }];
  }));
  return {
    samples: withReview,
    summary: {
      attempted: samples.length,
      withPlayback: samples.filter(({ recording }) => recording).length,
      awaitingAudioReview: withReview.filter(({ recording, assessment }) => recording && !assessment).length,
      verificationBeforeRelease: {
        passed: samples.filter(({ backend }) => backend?.verifiedBeforeRelease).length,
        required: samples.filter(({ playbackReviewRequired, expect }) => playbackReviewRequired && expect.kind !== 'revoked').length,
      },
      ordinaryWithinTwoSeconds: {
        passed: routine.filter(({ assessment }) => assessment?.outcome === 'correct'
          && assessment.speechEndToFirstFactMs >= 0 && assessment.speechEndToFirstFactMs <= 2_000).length,
        assessed: routine.filter(({ assessment }) => assessment).length,
        denominator: routine.length,
      },
      startToCorrectFactMs: distribution(routine.map(({ assessment }) => assessment?.speechStartToFirstFactMs)),
      endToCorrectFactMs: distribution(routine.map(({ assessment }) => assessment?.speechEndToFirstFactMs)),
      startToAnswerEndMs: distribution(routine.map(({ assessment }) => assessment?.speechStartToAnswerEndMs)),
      groups,
      stages,
    },
  };
}
