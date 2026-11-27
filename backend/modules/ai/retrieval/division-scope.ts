import type { DivisionRef } from './request-types.js';
import type { RetrievalDatabase } from './schema.js';
import { phraseIndex, wordsOf } from './words.js';

export async function readDivisions(db: RetrievalDatabase) {
  const { rows } = await db.query<DivisionRef>('SELECT id, name, code FROM public.divisions ORDER BY name, id');
  return rows;
}

export type DivisionMatch = { division?: DivisionRef; consumed: Set<number>; error?: string };
const scopeTokens = new Set(['divisi', 'departemen', 'tim', 'di', 'dari', 'untuk']);
const divisionTokens = new Set(['divisi', 'departemen']);
const directScopeTokens = new Set(['rekap', 'ringkasan', 'progres', 'progress', 'status', 'perkembangan', 'tugas']);

export function matchDivision(words: string[], divisions: DivisionRef[], correction: boolean, temporal = new Set<number>()): DivisionMatch {
  const matches = divisions.flatMap((division) => [division.name, division.code].flatMap((value) => {
    const phrase = wordsOf(value);
    if (!phrase.length) return [];
    const index = phraseIndex(words, phrase);
    if (index < 0) return [];
    const before = words[index - 1];
    const after = index + phrase.length;
    const atEnd = words.slice(after).every((_, offset) => temporal.has(after + offset));
    const anchored = scopeTokens.has(before) || (index === 0 && atEnd) || (correction && index === 0)
      || (atEnd && index <= 2 && directScopeTokens.has(before) && directScopeTokens.has(words[0]));
    return anchored ? [{ division, index, length: phrase.length }] : [];
  })).sort((left, right) => right.length - left.length);
  const selected = matches[0];
  const consumed = new Set<number>();
  if (selected) {
    const conflicting = matches.some(({ division, index, length }) => division.id !== selected.division.id && (index !== selected.index || length === selected.length))
      || divisions.some((division) => division.id !== selected.division.id && [division.name, division.code].some((label) => {
        const tokens = wordsOf(label);
        const index = tokens.length ? phraseIndex(words, tokens, selected.index + selected.length) : -1;
        return index > 0 && ['dan', 'atau'].includes(words[index - 1]);
      }));
    if (conflicting) return { consumed, error: 'Ada beberapa divisi yang disebut. Divisi mana yang ingin Anda lihat?' };
    for (let index = selected.index; index < selected.index + selected.length; index += 1) consumed.add(index);
    if (scopeTokens.has(words[selected.index - 1])) consumed.add(selected.index - 1);
    if (scopeTokens.has(words[selected.index - 2])) consumed.add(selected.index - 2);
    return { division: selected.division, consumed };
  }
  if (words.some((word, index) => divisionTokens.has(word) && words[index + 1] && !['itu', 'tersebut', 'tadi', 'semua', 'mana'].includes(words[index + 1]))) {
    return { consumed, error: 'Divisi tersebut belum bisa saya pastikan. Apa nama divisinya?' };
  }
  return { consumed };
}
