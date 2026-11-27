import { readFile, writeFile } from 'node:fs/promises';
import { parseCeoIntent } from '../backend/modules/ai/retrieval/intent.ts';
import { normalized } from '../backend/modules/ai/retrieval/words.ts';

const [corpusPath, reportPath] = process.argv.slice(2);
const preservePeriod = process.argv.includes('--preserve-period');
const respectQuotes = process.argv.includes('--respect-quotes');
if (!corpusPath || !reportPath) throw new Error('Berikan corpus dan tujuan laporan.');
const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));
const divisions = corpus.divisions.map((name) => ({ id: name, name, code: name }));
const clock = new Date(corpus.clock);

function canonical(value) {
  return value.normalize('NFKC').toLocaleLowerCase('id-ID')
    .replaceAll('—', ' ').replaceAll('–', ' ').split(/\s+/u).filter(Boolean).join(' ');
}

const separator = new Set([' ', ',', '.', ':', ';', '!', '?', '(', ')', '[', ']', '"', '“', '”', '‘', '’']);
const boundary = (character) => character === undefined || separator.has(character);

function completeSpans(transcript, title) {
  const spans = [];
  for (let position = transcript.indexOf(title); position >= 0;
    position = transcript.indexOf(title, position + 1)) {
    const end = position + title.length;
    if (boundary(transcript[position - 1]) && boundary(transcript[end])) spans.push({ start: position, end });
  }
  return spans;
}

function inside(span, outer) {
  return span.start >= outer.start && span.end <= outer.end;
}

function visible({ kind, division: rowDivision, from, to }, request) {
  const { entityKind, division, asOf } = request;
  const cutoff = asOf ? new Date(asOf) : clock;
  return (!from || new Date(from) <= cutoff) && (!to || new Date(to) > cutoff)
    && (!entityKind || entityKind === kind) && (!division || division.name === rowDivision);
}

// Simulate the current exact SQL branch with the same synthetic catalog.
function baselineEntity({ text, rows }) {
  const parsed = parseCeoIntent(text, divisions, clock);
  if (parsed.kind !== 'request' || !parsed.request.subject) return;
  const { subject } = parsed.request;
  const ids = rows.flatMap(([id, kind, title, division, from, to]) => (
    visible({ kind, division, from, to }, parsed.request) && title.toLowerCase() === subject
    && normalized(title) === subject ? [id] : []
  ));
  if (ids.length === 1) return ids[0];
}

function explicitTitleRanges(text) {
  const ranges = [];
  let open;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (open && character === open.close) {
      const content = text.slice(open.position + 1, index);
      const start = open.position + 1 + content.length - content.trimStart().length;
      const end = open.position + 1 + content.trimEnd().length;
      if (start >= end) return;
      ranges.push({ start, end });
      open = undefined;
    } else if (character === '"' || character === '“' || character === '”') {
      if (open || character === '”') return;
      open = { position: index, close: character === '“' ? '”' : '"' };
    }
  }
  if (!open) return ranges;
}

function identify({ text, rows }) {
  const transcript = canonical(text);
  const ranges = respectQuotes ? explicitTitleRanges(transcript) : [];
  if (!ranges) return;
  const matches = rows.flatMap(([id, kind, title, division, from, to]) => {
    const name = canonical(title);
    if (!name) return [];
    return completeSpans(transcript, name)
      .filter((span) => ranges.every((range) => span.end <= range.start || span.start >= range.end
        || (span.start === range.start && span.end === range.end)))
      .map((span) => ({ ...span, id, kind, division, from, to }));
  });
  if (matches.some((left) => matches.some((right) => left.end <= right.start))) return;

  const plausible = matches.flatMap((row) => {
    const outside = transcript.slice(0, row.start) + ' ' + transcript.slice(row.end);
    const parsed = parseCeoIntent(outside, divisions, clock);
    if (parsed.kind !== 'request') return [];
    const { entityKind, division, asOf, period } = parsed.request;
    if (!visible(row, parsed.request)) return [];
    const scope = [entityKind, division?.name, asOf];
    if (preservePeriod && period) scope.push(period.from, period.to);
    return [{ ...row, scope: scope.join('|') }];
  });

  const maximal = plausible.filter((row) => !plausible.some((other) => other.scope === row.scope
    && inside(row, other) && (row.start !== other.start || row.end !== other.end)));
  const ids = [...new Set(maximal.map(({ id }) => id))];
  if (ids.length === 1) return ids[0];
}

const results = corpus.cases.map((entry) => {
  const selected = identify(entry) ?? null;
  const baseline = baselineEntity(entry) ?? null;
  return {
    id: entry.id, text: entry.text, expected: entry.expected, entity: entry.entity ?? null, selected, baseline,
    correct: entry.expected === 'auto' ? selected === entry.entity : selected === null,
  };
});
function score(field) {
  const expectedAuto = results.filter(({ expected }) => expected === 'auto').length;
  const correct = (entry) => entry[field] === (entry.expected === 'auto' ? entry.entity : null);
  return {
    total: results.length,
    correct: results.filter(correct).length,
    expectedAuto,
    safeAuto: results.filter((entry) => entry.expected === 'auto' && correct(entry)).length,
    missedAuto: results.filter((entry) => entry.expected === 'auto' && entry[field] === null).length,
    incorrectAuto: results.filter((entry) => entry[field] !== null && !correct(entry)).length,
  };
}
const summary = { ...score('selected'), baseline: score('baseline') };
await writeFile(reportPath, JSON.stringify({ ...summary, results }, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(summary));
