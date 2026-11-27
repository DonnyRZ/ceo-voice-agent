import type { VoiceHistoryEntry } from './history/entry.js';
import { createVoiceTranscript, isPossibleEnding, maximumFragmentCharacters, maximumShortEndingGapMs, type VoiceTranscriptFragment } from './transcript.js';
import type { VoiceTurns } from './turn.js';
import type { VoiceMetric } from './types.js';

// Pilot eventually contained final fragments that had missed a 550 ms handoff.
const transcriptRepairWaitMs = 1_200;

export function createVoiceInput<Context, Facts, Prepared>(
  turns: Pick<VoiceTurns<Context, Facts, Prepared>, 'begin' | 'observeUserAudio' | 'prepare' | 'resolve' | 'unverifiedInput'>,
  options: {
    settleMs?: number;
    prepareCandidates: boolean;
    record?(entry: VoiceHistoryEntry<Facts>): void;
    metric(metric: VoiceMetric, turnId: string): void;
  },
) {
  const transcript = createVoiceTranscript();
  let settle: ReturnType<typeof setTimeout> | undefined;
  let pending: { id: string; offsetMs: number; quietUntil: number; deadline: number } | undefined;
  const settleMs = options.settleMs ?? 250;
  const waitMs = options.settleMs === undefined ? transcriptRepairWaitMs : Math.max(settleMs, 550);
  const quietMs = Math.min(settleMs, 160);

  function append(fragment: VoiceTranscriptFragment) {
    if (fragment.role === 'user' && !transcript.append(fragment)) return false;
    options.record?.({
      type: 'transcript',
      fragment: { ...fragment, text: fragment.text.slice(0, maximumFragmentCharacters) },
    });
    if (fragment.role === 'user') {
      const current = pending;
      if (current && (fragment.endMs <= current.offsetMs || isPossibleEnding(fragment, current.offsetMs))) {
        current.quietUntil = Math.max(current.quietUntil, performance.now() + quietMs);
        schedule(current.quietUntil);
      } else {
        turns.observeUserAudio(fragment.endMs);
        if (current) interrupt();
      }
      if (options.prepareCandidates) turns.prepare(transcript.previewText());
    }
    return true;
  }

  function delegate(id: string, offsetMs: number) {
    options.record?.({ type: 'delegation_received', turnId: id, offsetMs });
    if (!transcript.registerDelegation({ id, offsetMs })) return;
    if (!turns.begin(id, offsetMs)) {
      transcript.discardDelegation(id);
      options.metric({ type: 'delegation', action: 'discarded' }, id);
      return;
    }
    if (pending) transcript.discardDelegation(pending.id);
    const now = performance.now();
    pending = { id, offsetMs, quietUntil: now + settleMs, deadline: now + waitMs };
    schedule(pending.quietUntil);
  }

  function schedule(at: number) {
    if (!pending) return;
    clearTimeout(settle);
    settle = setTimeout(dispatch, Math.max(0, Math.min(at, pending.deadline) - performance.now()));
  }

  function dispatch() {
    if (!pending) return;
    const { id, deadline, quietUntil } = pending;
    const preview = transcript.peekDelegation(id, true);
    const remainingSpeech = preview ? pending.offsetMs - preview.userEndMs : undefined;
    const hasQuietPeriod = performance.now() >= quietUntil - 2;
    if ((!hasQuietPeriod || remainingSpeech === undefined
      || remainingSpeech >= 0 && remainingSpeech <= maximumShortEndingGapMs) && performance.now() < deadline - 2) {
      schedule(deadline);
      return;
    }
    pending = undefined;
    const input = transcript.takeDelegation(id, true);
    if (!input || !hasQuietPeriod) {
      options.metric({ type: 'delegation', action: 'discarded' }, id);
      turns.unverifiedInput(id);
      return;
    }
    options.record?.({
      type: 'turn_input', turnId: id, text: input.text,
      userEndMs: input.userEndMs, delegationOffsetMs: input.offsetMs,
    });
    options.metric({
      type: 'latency', stage: 'input_to_delegation', outcome: 'observed', durationMs: Math.max(0, input.offsetMs - input.userEndMs),
    }, id);
    void turns.resolve(input);
  }

  function pause() {
    clearTimeout(settle);
    pending = undefined;
    transcript.pause();
  }

  function interrupt() {
    if (!pending) return;
    const { id } = pending;
    clearTimeout(settle);
    pending = undefined;
    transcript.takeDelegation(id, true);
    options.metric({ type: 'delegation', action: 'discarded' }, id);
  }

  return { append, delegate, interrupt, pause, close: pause };
}
