import type { VoiceHistoryEntry } from './history/entry.js';
import { createVoiceTranscript, maximumFragmentCharacters, type VoiceTranscriptFragment } from './transcript.js';
import type { VoiceTurns } from './turn.js';
import type { VoiceMetric } from './types.js';

export function createVoiceInput<Context, Facts, Prepared>(
  turns: VoiceTurns<Context, Facts, Prepared>,
  options: {
    settleMs?: number;
    prepareCandidates: boolean;
    record?(entry: VoiceHistoryEntry<Facts>): void;
    metric(metric: VoiceMetric, turnId: string): void;
  },
) {
  const transcript = createVoiceTranscript();
  let settle: ReturnType<typeof setTimeout> | undefined;
  let latestDelegation: string | undefined;

  function append(fragment: VoiceTranscriptFragment) {
    if (!transcript.append(fragment)) return;
    options.record?.({
      type: 'transcript',
      fragment: { ...fragment, text: fragment.text.slice(0, maximumFragmentCharacters) },
    });
    if (fragment.role === 'user') {
      turns.observeUserAudio(fragment.endMs);
      if (options.prepareCandidates) turns.prepare(transcript.previewText());
    }
  }

  function delegate(id: string, offsetMs: number) {
    if (!transcript.registerDelegation({ id, offsetMs })) return;
    if (!turns.begin(id, offsetMs)) {
      transcript.discardDelegation(id);
      options.metric({ type: 'delegation', action: 'discarded' }, id);
      return;
    }
    if (latestDelegation) transcript.takeDelegation(latestDelegation);
    latestDelegation = id;
    clearTimeout(settle);
    settle = setTimeout(() => {
      latestDelegation = undefined;
      const input = transcript.takeDelegation(id);
      if (!input) {
        options.metric({ type: 'delegation', action: 'discarded' }, id);
        return;
      }
      options.record?.({
        type: 'turn_input', turnId: id, text: input.text,
        userEndMs: input.userEndMs, delegationOffsetMs: input.offsetMs,
      });
      options.metric({
        type: 'latency', stage: 'input_to_delegation', outcome: 'observed', durationMs: input.offsetMs - input.userEndMs,
      }, id);
      void turns.resolve(input);
    }, options.settleMs ?? 250);
  }

  return { append, delegate, close: () => clearTimeout(settle) };
}
