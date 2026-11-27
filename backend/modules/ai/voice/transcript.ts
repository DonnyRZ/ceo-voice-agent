import { buildHistory, compareOffsets, latestSpeech, remember, speechText, validOffset,
  type VoiceTranscriptFragment, type VoiceTranscriptMessage } from './transcript-timeline.js';

export type { VoiceTranscriptFragment, VoiceTranscriptMessage } from './transcript-timeline.js';

type Delegation = { id: string; offsetMs: number };

export type VoiceTurn = Delegation & {
  text: string;
  history: VoiceTranscriptMessage[];
  userEndMs: number;
};

const maximumDelegationLagMs = 8_000;
export const maximumTranscriptOverhangMs = 400;
export const maximumShortEndingGapMs = 800;
const observedTranscriptFrameMs = 200;
export const maximumFragmentCharacters = 2_000;
const maximumFragments = 400;
const maximumEventIds = 1_600;
const maximumDelegationIds = 256;

export function createVoiceTranscript() {
  const fragments: VoiceTranscriptFragment[] = [];
  const eventIds = new Set<string>();
  const delegationIds = new Set<string>();
  const pending = new Map<string, Delegation>();
  let consumedSpeechMs = -1;
  let consumedDelegationMs = -1;

  function append(fragment: VoiceTranscriptFragment): boolean {
    if (!fragment.eventId || eventIds.has(fragment.eventId) || !fragment.text
      || !validOffset(fragment.startMs) || !validOffset(fragment.endMs) || fragment.endMs < fragment.startMs
      || (fragment.role === 'user' && !freshSpeech(fragment))) {
      return false;
    }

    remember(eventIds, fragment.eventId, maximumEventIds);
    fragments.push({ ...fragment, text: fragment.text.slice(0, maximumFragmentCharacters) });
    if (fragments.length > maximumFragments) fragments.shift();
    return true;
  }

  function registerDelegation(delegation: Delegation): boolean {
    if (!delegation.id || delegationIds.has(delegation.id) || !validOffset(delegation.offsetMs)
      || delegation.offsetMs <= consumedDelegationMs || pending.size >= maximumDelegationIds) {
      return false;
    }

    remember(delegationIds, delegation.id, maximumDelegationIds);
    pending.set(delegation.id, { ...delegation });
    return true;
  }

  function takeDelegation(id: string, includeStraddlingFragment = false): VoiceTurn | null {
    const delegation = pending.get(id);
    if (!delegation) return null;
    const turn = peekDelegation(id, includeStraddlingFragment);
    if (!turn && includeStraddlingFragment && delegation.offsetMs > consumedDelegationMs) {
      const predecessor = freshUserSpeech(sortedThrough(delegation.offsetMs)).at(-1);
      const uncertainEndings = possibleEndings(delegation.offsetMs, predecessor);
      // An ambiguous suffix must not flow from a discarded delegation into the next request.
      if (uncertainEndings.length > 1) {
        consumedSpeechMs = Math.max(consumedSpeechMs, ...uncertainEndings.map(({ endMs }) => endMs));
      }
    }
    pending.delete(id);
    consumedDelegationMs = Math.max(consumedDelegationMs, delegation.offsetMs);
    if (turn) consumedSpeechMs = Math.max(consumedSpeechMs, turn.userEndMs);
    return turn;
  }

  function peekDelegation(id: string, includeStraddlingFragment = false): VoiceTurn | null {
    const delegation = pending.get(id);
    if (!delegation || delegation.offsetMs <= consumedDelegationMs) return null;

    const timeline = sortedThrough(delegation.offsetMs);
    const current = currentSpeech(delegation.offsetMs, timeline, includeStraddlingFragment);
    if (!current?.length) return null;
    const userEndMs = Math.max(...current.map(({ endMs }) => endMs));
    if (delegation.offsetMs - userEndMs > maximumDelegationLagMs) return null;

    const text = speechText(current);
    if (!text) return null;

    const preceding = timeline.filter((fragment) => fragment !== current[0] && fragment.endMs <= current[0].startMs);
    return { ...delegation, text, history: buildHistory(preceding), userEndMs };
  }

  function freshSpeech(fragment: VoiceTranscriptFragment) {
    return fragment.startMs >= consumedSpeechMs && fragment.endMs > consumedDelegationMs;
  }

  function freshUserSpeech(timeline: VoiceTranscriptFragment[]) {
    return timeline.filter((fragment) => fragment.role === 'user' && freshSpeech(fragment));
  }

  function possibleEndings(offsetMs: number, predecessor?: VoiceTranscriptFragment) {
    const gap = predecessor ? offsetMs - predecessor.endMs : Infinity;
    return fragments.filter((fragment) => {
      if (!freshSpeech(fragment) || !isPossibleEnding(fragment, offsetMs)) return false;
      if (fragment.startMs < offsetMs) return true;
      // Live uses 200 ms transcript intervals. A one-frame ending can follow a sparse predecessor.
      const maximumGap = fragment.endMs - fragment.startMs <= observedTranscriptFrameMs
        ? maximumShortEndingGapMs : maximumTranscriptOverhangMs;
      return gap <= maximumGap;
    });
  }

  function currentSpeech(offsetMs: number, timeline: VoiceTranscriptFragment[], repair: boolean) {
    const available = freshUserSpeech(timeline);
    if (!repair) return latestSpeech(available);
    const endings = possibleEndings(offsetMs, available.at(-1));
    // One short frame may cross or touch the delegation boundary. More than one is ambiguous.
    if (endings.length > 1) return;
    if (endings.length === 1) available.push(endings[0]);
    return latestSpeech(available.sort(compareOffsets));
  }

  function sortedThrough(offsetMs: number) {
    return fragments.filter((fragment) => fragment.endMs <= offsetMs).sort(compareOffsets);
  }

  function previewText() {
    return speechText(latestSpeech(freshUserSpeech(sortedThrough(Infinity))));
  }

  function pause() {
    for (const fragment of fragments) {
      if (fragment.role === 'user') consumedSpeechMs = Math.max(consumedSpeechMs, fragment.endMs);
    }
    for (const delegation of pending.values()) consumedDelegationMs = Math.max(consumedDelegationMs, delegation.offsetMs);
    consumedDelegationMs = Math.max(consumedDelegationMs, consumedSpeechMs);
    pending.clear();
  }

  return { append, registerDelegation, takeDelegation, peekDelegation, pause, previewText,
    discardDelegation: (id: string) => pending.delete(id) };
}

export function isPossibleEnding(fragment: VoiceTranscriptFragment, offsetMs: number) {
  return fragment.role === 'user' && fragment.startMs <= offsetMs
    && fragment.endMs > offsetMs && fragment.endMs <= offsetMs + maximumTranscriptOverhangMs;
}
