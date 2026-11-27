export type VoiceTranscriptMessage = {
  role: 'user' | 'assistant';
  text: string;
};

export type VoiceTranscriptFragment = VoiceTranscriptMessage & {
  eventId: string;
  startMs: number;
  endMs: number;
};

const maximumTurnGapMs = 1_500;
const maximumTurnCharacters = 2_000;
const maximumHistoryCharacters = 6_000;
const maximumHistoryMessages = 12;

export function compareOffsets(left: VoiceTranscriptFragment, right: VoiceTranscriptFragment) {
  return left.startMs - right.startMs || left.endMs - right.endMs;
}

export function latestSpeech(speech: VoiceTranscriptFragment[]) {
  let start = Math.max(0, speech.length - 1);
  while (start > 0 && speech[start].startMs - speech[start - 1].endMs <= maximumTurnGapMs) start -= 1;
  return speech.slice(start);
}

export function speechText(fragments: VoiceTranscriptFragment[]) {
  return fragments.map((fragment) => fragment.text).join('').trim().slice(0, maximumTurnCharacters);
}

export function validOffset(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function remember(ids: Set<string>, id: string, limit: number): void {
  ids.add(id);
  if (ids.size > limit) {
    const oldest = ids.values().next();
    if (!oldest.done) ids.delete(oldest.value);
  }
}

export function buildHistory(fragments: VoiceTranscriptFragment[]): VoiceTranscriptMessage[] {
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
