import { addDays, addMonths, calendarDay, endOfJakartaDay, jakartaDate, monthRange, weekStart } from './calendar.js';
import type { CeoPeriod } from './schema.js';
import { readNumber } from './words.js';

type Span = { from: string; to: string; end: number };
export type TemporalScope = { period?: CeoPeriod; asOf?: string; consumed: Set<number>; error?: string };
const monthWords = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember'];
const temporalError = 'Tanggal atau periode mana yang Anda maksud?';

function daySpan(day: string | undefined, end: number): Span | undefined {
  if (day) return { from: day, to: day, end };
}

function readNumericDate(words: string[], start: number, today: string) {
  const first = readNumber(words, start);
  if (!first) return;
  const offset = start + first.length;
  const second = readNumber(words, offset);
  const third = second && readNumber(words, offset + second.length);
  if (second && third && first.value >= 1900) {
    return daySpan(calendarDay(first.value, second.value, third.value), offset + second.length + third.length);
  }
  if (second && third && third.value >= 1900) {
    return daySpan(calendarDay(third.value, second.value, first.value), offset + second.length + third.length);
  }
  const month = monthWords.indexOf(words[offset]);
  if (month < 0) return;
  const explicitYear = readNumber(words, offset + 1);
  const year = explicitYear && explicitYear.value >= 1900 ? explicitYear : undefined;
  return daySpan(calendarDay(year?.value ?? Number(today.slice(0, 4)), month + 1, first.value), offset + 1 + (year?.length ?? 0));
}

function readSpan(words: string[], start: number, today: string): Span | undefined {
  const token = words[start];
  const next = words[start + 1];
  if (token === 'tanggal' || token === 'pada') return readSpan(words, start + 1, today);
  if (token === 'awal' || token === 'akhir') {
    const span = readSpan(words, start + 1, today);
    if (span) return daySpan(token === 'awal' ? span.from : span.to, span.end);
    return;
  }
  if (token === 'kemarin') return daySpan(addDays(today, -1), start + 1);
  if (token === 'hari' && next === 'ini') return daySpan(today, start + 2);
  if (token === 'sekarang') return daySpan(today, start + 1);
  if (token === 'minggu' && ['ini', 'lalu'].includes(next)) {
    const from = addDays(weekStart(today), next === 'lalu' ? -7 : 0);
    return { from, to: next === 'lalu' ? addDays(from, 6) : today, end: start + 2 };
  }
  if (token === 'bulan' && ['ini', 'lalu', 'depan'].includes(next)) {
    return { ...monthRange(addMonths(today, next === 'lalu' ? -1 : next === 'depan' ? 1 : 0)), end: start + 2 };
  }
  const monthOffset = token === 'bulan' ? start + 1 : start;
  const month = monthWords.indexOf(words[monthOffset]);
  if (month >= 0) {
    const explicitYear = readNumber(words, monthOffset + 1);
    const year = explicitYear && explicitYear.value >= 1900 ? explicitYear : undefined;
    const day = calendarDay(year?.value ?? Number(today.slice(0, 4)), month + 1, 1);
    if (day) return { ...monthRange(day), end: monthOffset + 1 + (year?.length ?? 0) };
  }
  const number = readNumber(words, start);
  const unit = number ? words[start + number.length] : token === 'sebulan' ? 'bulan' : token === 'seminggu' ? 'minggu' : '';
  const end = start + (number ? number.length + 1 : 1);
  const amount = number?.value ?? 1;
  if (amount >= 1 && amount <= 365 && words[end] === 'terakhir') {
    if (unit === 'hari' || unit === 'minggu') return { from: addDays(today, 1 - amount * (unit === 'minggu' ? 7 : 1)), to: today, end: end + 1 };
    if (unit === 'bulan' && amount <= 36) return { from: addDays(addMonths(today, -amount), 1), to: today, end: end + 1 };
  }
  return readNumericDate(words, start, today);
}

function consumed(start: number, end: number) {
  return new Set(Array.from({ length: end - start }, (_, offset) => start + offset));
}

export function parseTemporal(words: string[], now: Date, allowBareMonth = false, statusSnapshot = false): TemporalScope {
  const today = jakartaDate(now);
  const cutoff = words.findIndex((word, index) => word === 'per'
    || (statusSnapshot && word === 'pada' && ['awal', 'akhir', 'tanggal'].includes(words[index + 1])));
  if (cutoff >= 0) {
    const span = readSpan(words, cutoff + 1, today);
    if (!span || (words[cutoff] === 'pada' && span.from !== span.to)) return { consumed: new Set(), error: temporalError };
    if (span.to > today) return { consumed: new Set(), error: 'Tanggal acuan tersebut masih di masa depan. Per tanggal berapa yang Anda maksud?' };
    const period = parseTemporal(words.slice(0, cutoff), now, allowBareMonth);
    if (period.error) return period;
    return { period: period.period, asOf: endOfJakartaDay(span.to), consumed: new Set([...period.consumed, ...consumed(cutoff, span.end)]) };
  }
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word === 'sekarang') continue;
    if (monthWords.includes(word) && !allowBareMonth && !['bulan', 'awal', 'akhir', 'pada'].includes(words[index - 1])) continue;
    const span = readSpan(words, index, today);
    if (!span) continue;
    const marker = words[index - 1];
    const start = ['dari', 'sejak', 'sampai', 'hingga', 'selama'].includes(marker) ? index - 1 : index;
    if (['sampai', 'hingga'].includes(words[span.end])) {
      const last = readSpan(words, span.end + 1, today);
      if (!last || last.to < span.from) return { consumed: new Set(), error: temporalError };
      return { period: { from: span.from, to: last.to }, consumed: consumed(start, last.end) };
    }
    const period = marker === 'sejak' ? { from: span.from, to: today }
      : ['sampai', 'hingga'].includes(marker) ? { to: span.to } : { from: span.from, to: span.to };
    if (period.from && period.to && period.from > period.to) return { consumed: new Set(), error: temporalError };
    return { period, consumed: consumed(start, span.end) };
  }
  if (words.includes('tanggal') || words.includes('periode')) return { consumed: new Set(), error: temporalError };
  return { consumed: new Set() };
}
