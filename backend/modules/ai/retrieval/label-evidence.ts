import type { DivisionRef } from './request-types.js';

const separator = /[\s,.;:!?()[\]"“”‘’]/u;
const maxProbes = 2048;

export function titleText(text: string) {
  return text.normalize('NFKC').toLocaleLowerCase('id-ID').replace(/[–—\s]+/gu, ' ').trim();
}

export type TitleSpan = { text: string; start: number; end: number };

function boundary(character: string | undefined) {
  return character === undefined || separator.test(character);
}

export function literalSpans(text: string, phrase: string): TitleSpan[] {
  if (!phrase) return [];
  const spans: TitleSpan[] = [];
  for (let start = text.indexOf(phrase); start >= 0; start = text.indexOf(phrase, start + 1)) {
    const end = start + phrase.length;
    if (boundary(text[start - 1]) && boundary(text[end])) spans.push({ text: phrase, start, end });
  }
  return spans;
}

function quoteRanges(text: string, terminalSubject?: string): TitleSpan[] | undefined {
  const ranges: TitleSpan[] = [];
  let open: { start: number; close: string } | undefined;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (open?.close === character) {
      const content = text.slice(open.start, index);
      const start = open.start + content.length - content.trimStart().length;
      const end = open.start + content.trimEnd().length;
      if (end <= start) return;
      ranges.push({ text: text.slice(start, end), start, end });
      open = undefined;
    } else if (character === '"' || character === '“' || character === '‘') {
      if (open) return;
      open = { start: index + 1, close: character === '“' ? '”' : character === '‘' ? '’' : '"' };
    }
  }
  if (open) {
    const remainder = text.slice(open.start);
    const start = open.start + remainder.length - remainder.trimStart().length;
    const end = start + (terminalSubject?.length ?? 0);
    // Speech transcription can omit a closing quote. Only an entire literal
    // trailing subject supplies its boundary without guessing a shorter title.
    if (!terminalSubject || text.slice(start, end) !== terminalSubject || !/^[.!?\s]*$/u.test(text.slice(end))) return;
    ranges.push({ text: terminalSubject, start, end });
  }
  return ranges;
}

export function inside(span: TitleSpan, outer: TitleSpan) {
  return span.start >= outer.start && span.end <= outer.end;
}

export function withoutDivisionOverlap(transcript: string, subject: string, excerpt: string, division: DivisionRef) {
  const text = titleText(transcript);
  const subjects = literalSpans(text, titleText(subject));
  const scopes = literalSpans(text, titleText(excerpt));
  if (subjects.length !== 1 || scopes.length !== 1) return subject;
  const [named] = subjects;
  const [scope] = scopes;
  if (scope.start <= named.start || scope.start >= named.end || scope.end <= named.end) return subject;
  const beyondSubject = text.slice(named.end, scope.end);
  if (![division.name, division.code].some((label) => literalSpans(beyondSubject, titleText(label)).length)) return subject;
  const quotes = quoteRanges(text);
  if (!quotes || quotes.some((quote) => scope.start >= quote.start && scope.start < quote.end)) return subject;
  return text.slice(named.start, scope.start).trimEnd();
}

export function supersededTitle(transcript: string, subject: string, correction: { supersededSubject: string; bridge: string }) {
  const text = titleText(transcript);
  const old = literalSpans(text, titleText(correction.supersededSubject));
  const replacement = literalSpans(text, titleText(subject));
  const quotes = quoteRanges(text);
  if (old.length !== 1 || replacement.length !== 1 || !quotes || old[0].end >= replacement[0].start) return;
  const bridge = titleText(text.slice(old[0].end, replacement[0].start));
  const words = bridge.match(/\p{L}+/gu)?.filter((word) => !workKindIn(word)) ?? [];
  if (bridge !== titleText(correction.bridge) || words.length < 2) return;
  const spans = [old[0], replacement[0]];
  if (spans.some((span) => quotes.some((quote) => span.start < quote.end && span.end > quote.start
      && (span.start !== quote.start || span.end !== quote.end)))) return;
  return old[0];
}

export function titleEvidence(transcript: string, subject: string) {
  const text = titleText(transcript);
  const normalizedSubject = titleText(subject);
  const named = literalSpans(text, normalizedSubject);
  const quotes = quoteRanges(text, normalizedSubject);
  if (named.length !== 1 || !quotes) return;
  const [selected] = named;
  if (quotes.some((quote) => inside(selected, quote) && (selected.start !== quote.start || selected.end !== quote.end))) return;
  const probes = probeSpans(text, quotes, [selected, ...quotes]);
  if (probes) return { text, selected, probes };
}

export function catalogueTitleProbes(transcript: string) {
  const text = titleText(transcript);
  const quotes = quoteRanges(text);
  if (!quotes) return;
  const probes = probeSpans(text, quotes, [...quotes]);
  if (probes) return [...new Set(probes.map(({ text }) => text))];
}

function probeSpans(text: string, quotes: TitleSpan[], probes: TitleSpan[]) {
  const starts: number[] = [];
  const ends: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (boundary(text[index - 1]) && !boundary(text[index])) starts.push(index);
    if (!boundary(text[index]) && boundary(text[index + 1])) ends.push(index + 1);
  }
  for (const start of starts) {
    for (const end of ends) {
      if (end <= start || end - start > 512) continue;
      const probe = { text: text.slice(start, end), start, end };
      if (quotes.some((quote) => start < quote.end && end > quote.start
        && (start !== quote.start || end !== quote.end))) continue;
      probes.push(probe);
      if (probes.length > maxProbes) return;
    }
  }
  return probes;
}

export function outsideSpan(text: string, span: TitleSpan, ignored?: TitleSpan) {
  if (!ignored) return `${text.slice(0, span.start)} ${text.slice(span.end)}`;
  const [first, second] = span.start <= ignored.start ? [span, ignored] : [ignored, span];
  return `${text.slice(0, first.start)} ${text.slice(first.end, second.start)} ${text.slice(Math.max(first.end, second.end))}`;
}

export function withoutSubject(transcript: string, subject: string | null) {
  const text = titleText(transcript);
  if (!subject) return text;
  const spans = literalSpans(text, titleText(subject));
  if (spans.length !== 1) return text;
  return outsideSpan(text, spans[0]);
}

export function workKindIn(text: string) {
  const project = literalSpans(text, 'proyek').length || literalSpans(text, 'project').length;
  const task = literalSpans(text, 'tugas').length || literalSpans(text, 'task').length;
  if (project && task) return 'ambiguous';
  if (project) return 'project';
  if (task) return 'task';
}

export function workTitleMarker(subject: string): { kind: ReturnType<typeof workKindIn>; subject: string } | undefined {
  const match = /^(proyek|project|tugas|task) (.+)$/u.exec(subject);
  if (match) return { kind: workKindIn(match[1]), subject: match[2] };
}

export function titleTypeMarker(text: string, span: TitleSpan) {
  let prefix = text.slice(0, span.start).trimEnd();
  if (['"', '“', '‘'].includes(prefix.at(-1) ?? '')) prefix = prefix.slice(0, -1).trimEnd();
  const token = prefix.slice(prefix.lastIndexOf(' ') + 1);
  return workTitleMarker(`${token} ${span.text}`)?.kind;
}
