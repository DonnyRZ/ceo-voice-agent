export type VoiceTranscriptMessage = {
  role: 'user' | 'assistant';
  text: string;
};

export type VoiceTranscriptFragment = VoiceTranscriptMessage & {
  eventId: string;
  startMs: number;
  endMs: number;
};

type Delegation = { id: string; offsetMs: number };

export type VoiceTurn = Delegation & {
  text: string;
  history: VoiceTranscriptMessage[];
  userEndMs: number;
};

const maximumTurnGapMs = 1_500;
const maximumDelegationLagMs = 8_000;
export const maximumFragmentCharacters = 2_000;
const maximumTurnCharacters = 2_000;
const maximumHistoryCharacters = 6_000;
const maximumHistoryMessages = 12;
const maximumFragments = 400;
const maximumEventIds = 1_600;
const maximumDelegationIds = 256;

export function createVoiceTranscript() {
  const fragments: VoiceTranscriptFragment[] = [];
  const eventIds = new Set<string>();
  const delegationIds = new Set<string>();
  const pending = new Map<string, Delegation>();
  let consumedOffsetMs = -1;

  function append(fragment: VoiceTranscriptFragment): boolean {
    if (!fragment.eventId || eventIds.has(fragment.eventId) || !fragment.text
      || !validOffset(fragment.startMs) || !validOffset(fragment.endMs) || fragment.endMs < fragment.startMs) {
      return false;
    }

    remember(eventIds, fragment.eventId, maximumEventIds);
    fragments.push({ ...fragment, text: fragment.text.slice(0, maximumFragmentCharacters) });
    if (fragments.length > maximumFragments) fragments.shift();
    return true;
  }

  function registerDelegation(delegation: Delegation): boolean {
    if (!delegation.id || delegationIds.has(delegation.id) || !validOffset(delegation.offsetMs)
      || delegation.offsetMs <= consumedOffsetMs || pending.size >= maximumDelegationIds) {
      return false;
    }

    remember(delegationIds, delegation.id, maximumDelegationIds);
    pending.set(delegation.id, { ...delegation });
    return true;
  }

  function takeDelegation(id: string): VoiceTurn | null {
    const delegation = pending.get(id);
    if (!delegation) return null;
    pending.delete(id);
    if (delegation.offsetMs <= consumedOffsetMs) return null;

    const previousOffsetMs = consumedOffsetMs;
    consumedOffsetMs = delegation.offsetMs;

    const timeline = sortedThrough(delegation.offsetMs);
    const current = latestSpeech(timeline, previousOffsetMs);
    const last = current.at(-1);
    if (!last || delegation.offsetMs - last.endMs > maximumDelegationLagMs) return null;

    const text = speechText(current);
    if (!text) return null;

    const preceding = timeline.filter((fragment) => fragment !== current[0] && fragment.endMs <= current[0].startMs);
    return { ...delegation, text, history: buildHistory(preceding), userEndMs: last.endMs };
  }

  function sortedThrough(offsetMs: number) {
    return fragments.filter((fragment) => fragment.endMs <= offsetMs)
      .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  }

  function previewText() {
    return speechText(latestSpeech(sortedThrough(Infinity), consumedOffsetMs));
  }

  return { append, registerDelegation, takeDelegation, previewText, discardDelegation: (id: string) => pending.delete(id) };
}

function latestSpeech(timeline: VoiceTranscriptFragment[], afterMs: number) {
  const speech = timeline.filter((fragment) => fragment.role === 'user'
    && fragment.startMs >= afterMs && fragment.endMs > afterMs);
  let start = Math.max(0, speech.length - 1);
  while (start > 0 && speech[start].startMs - speech[start - 1].endMs <= maximumTurnGapMs) start -= 1;
  return speech.slice(start);
}

function speechText(fragments: VoiceTranscriptFragment[]) {
  return fragments.map((fragment) => fragment.text).join('').trim().slice(0, maximumTurnCharacters);
}

function validOffset(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function remember(ids: Set<string>, id: string, limit: number): void {
  ids.add(id);
  if (ids.size > limit) {
    const oldest = ids.values().next();
    if (!oldest.done) ids.delete(oldest.value);
  }
}

function buildHistory(fragments: VoiceTranscriptFragment[]): VoiceTranscriptMessage[] {
  const messages: Array<VoiceTranscriptMessage & { endMs: number }> = [];
  for (const fragment of fragments) {
    const last = messages.at(-1);
    if (last?.role === fragment.role && fragment.startMs - last.endMs <= maximumTurnGapMs) {
      last.text = (last.text + fragment.text).slice(-maximumHistoryCharacters);
      last.endMs = Math.max(last.endMs, fragment.endMs);
    } else {
      messages.push({ role: fragment.role, text: fragment.text, endMs: fragment.endMs });
    }
  }

  const history: VoiceTranscriptMessage[] = [];
  let availableCharacters = maximumHistoryCharacters;
  for (const message of messages.reverse()) {
    if (history.length >= maximumHistoryMessages || availableCharacters <= 0) break;

    const text = message.text.slice(-availableCharacters).trim();
    if (!text) continue;

    history.unshift({ role: message.role, text });
    availableCharacters -= text.length;
  }
  return history;
}
