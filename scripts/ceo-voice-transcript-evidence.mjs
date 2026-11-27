export function normalizedText(text) {
  return text.normalize('NFC').toLocaleLowerCase('id-ID').trim().replace(/\s+/gu, ' ');
}

function timestamp(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validLine(line) {
  return line && ['user', 'assistant'].includes(line.role) && typeof line.text === 'string' && line.text.length
    && timestamp(line.startMs) && timestamp(line.endMs) && line.endMs >= line.startMs;
}

function archiveStart(lines, input) {
  if (!input?.text || !timestamp(input.userEndMs)) return;
  const users = lines.filter(({ role, startMs }) => role === 'user' && startMs <= input.userEndMs);
  const end = users.findLastIndex((line) => line.endMs >= input.userEndMs);
  if (end < 0) return;
  const required = normalizedText(input.text);
  for (let start = end; start >= 0; start--) {
    const text = users.slice(start, end + 1).map((line) => line.text).join(' ');
    if (normalizedText(text).startsWith(required)) return users[start].startMs;
    if (start > 0 && users[start].startMs - users[start - 1].endMs > 1_500) return;
  }
}

function targetEvents(journal) {
  const rows = journal.events ?? [];
  const events = rows.map(({ entry }) => entry);
  const inputs = events.filter(({ type }) => type === 'turn_input');
  const started = events.findLast(({ type, metric }) => type === 'metric' && metric?.type === 'delegation' && metric.action === 'started');
  const turnId = started?.turnId ?? inputs.at(-1)?.turnId;
  const input = inputs.findLast((entry) => entry.turnId === turnId);
  const commentary = rows.findLast(({ entry }) => entry.type === 'commentary_sent' && entry.turnId === turnId);
  const ack = events.findLast((entry) => entry.type === 'commentary_ack' && entry.turnId === turnId && entry.accepted);
  const retrieval = events.findLast((entry) => entry.type === 'metric' && entry.turnId === turnId && entry.metric?.type === 'retrieval');
  const revoked = events.some(({ type, metric }) => type === 'metric' && metric?.type === 'session' && metric.reason === 'revoked');
  return { firstInput: inputs[0], input, turnId, commentary: commentary?.entry, commentarySequence: commentary?.sequence,
    ack, retrieval: retrieval?.metric, revoked };
}

function expectedText(sample) {
  const expected = sample.transcriptExpected;
  if (typeof expected === 'string') return expected;
  if (typeof expected?.text === 'string') {
    return [expected.text, expected.interruptionText].filter((part) => typeof part === 'string' && part.trim()).join(' ');
  }
}

function inputDiagnostic(recorded, assembled) {
  const transcript = normalizedText(recorded);
  const consumed = normalizedText(assembled ?? '');
  if (!transcript) return 'missing_provider_input';
  if (!consumed) return 'missing_assembled_input';
  if (transcript === consumed) return 'exact';
  if (transcript.startsWith(consumed)) return 'provider_text_continues_after_assembly';
  if (transcript.endsWith(consumed)) return 'assembly_uses_provider_suffix';
  return 'different';
}

export function extractTranscriptEvidence(sample) {
  const { journal } = sample;
  if (!journal) return { source: 'missing', lines: [], inputText: '', outputText: '', inputAssembly: 'missing_journal' };
  const target = targetEvents(journal);
  const raw = Array.isArray(journal.transcriptEvents);
  const fragments = raw ? journal.transcriptEvents.map(({ sequence, fragment }) => ({ ...fragment, sequence })) : journal.transcript ?? [];
  const eventIds = new Set();
  const lines = fragments.filter((fragment) => {
    if (!validLine(fragment) || (raw && eventIds.has(fragment.eventId))) return false;
    if (raw && typeof fragment.eventId === 'string') eventIds.add(fragment.eventId);
    return true;
  }).sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs || left.sequence - right.sequence);
  const firstUser = lines.filter(({ role }) => role === 'user').reduce((earliest, line) =>
    !earliest || line.startMs < earliest.startMs ? line : earliest, undefined);
  const hasSetup = Boolean(sample.setup?.length) || sample.mode === 'active' || sample.mode === 'standby';
  // Pilot raw events are already sliced by the runner's setup sequence. Archived groups need an input anchor.
  const startMs = !raw && hasSetup ? archiveStart(lines, target.firstInput) : firstUser?.startMs;
  const uncertainStart = hasSetup && startMs === undefined;
  const scoped = uncertainStart ? [] : lines.filter(({ endMs }) => !hasSetup || startMs === undefined || endMs > startMs);
  const input = scoped.filter(({ role }) => role === 'user');
  const output = scoped.filter(({ role }) => role === 'assistant');
  const inputText = input.map(({ text }) => text).join(raw ? '' : ' ').trim();
  const outputText = output.map(({ text }) => text).join(raw ? '' : ' ').trim();
  const followingProviderInput = target.input && input.filter(({ endMs, text }) => endMs > target.input.userEndMs && text.trim());
  const correction = sample.transcriptExpected?.interruptionText;
  const inputCorrection = typeof correction === 'string' && correction.trim() ? {
    reference: correction,
    providerLiteralSuffix: Boolean(inputText && normalizedText(inputText).endsWith(normalizedText(correction))),
    assembledLiteralSuffix: Boolean(target.input?.text && normalizedText(target.input.text).endsWith(normalizedText(correction))),
  } : undefined;
  const reference = expectedText(sample);
  const cutoffMs = target.ack?.endMs ?? target.input?.delegationOffsetMs ?? target.input?.userEndMs;
  const beforeCutoff = timestamp(cutoffMs) && output.some((line) => line.startMs < cutoffMs);
  const beforeCommentary = raw && Number.isSafeInteger(target.commentarySequence)
    ? output.some((line) => Number.isSafeInteger(line.sequence) && line.sequence < target.commentarySequence)
    : Boolean(target.input && output.some((line) => line.startMs < target.input.delegationOffsetMs));
  const hasAssistantTranscript = lines.some(({ role }) => role === 'assistant');

  return {
    ...target,
    source: raw ? 'provider_fragments' : 'archived_provider_groups',
    uncertainty: uncertainStart ? 'setup_boundary_missing'
      : journal.hasSequenceGaps ? 'journal_incomplete'
        : hasSetup && startMs !== undefined && output.some((line) => line.startMs < startMs) ? 'setup_output_overlap'
          : undefined,
    startMs, cutoffMs, cutoffSource: target.ack?.endMs !== undefined ? 'commentary_ack' : cutoffMs !== undefined ? 'delegation' : undefined,
    inputText, referenceText: reference, hasAssistantTranscript,
    inputComparison: reference && inputText ? normalizedText(reference) === normalizedText(inputText) ? 'exact' : 'different' : undefined,
    inputAssembly: inputDiagnostic(inputText, target.input?.text), inputCorrection, followingProviderInput,
    outputText, lines: output, beforeCutoff, beforeCommentary,
  };
}
