const digits = ['nol', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan'];
const magnitude = [
  [1_000_000_000_000_000, 'kuadriliun'],
  [1_000_000_000_000, 'triliun'],
  [1_000_000_000, 'miliar'],
  [1_000_000, 'juta'],
  [1_000, 'ribu'],
  [100, 'ratus'],
] as const;

// Keep decimal/grouping separators, signed values, and compound identifiers intact.
const integer = /(?<![\p{L}\p{M}\p{N}\p{Pd}_.,:/+±−])[0-9]+(?![\p{L}\p{M}\p{N}\p{Pd}_:/+±−]|[.,]\p{N})/gu;
const clock = /(?<![\p{L}\p{M}\p{N}\p{Pd}_])pukul ([0-9]{2})[.:]([0-9]{2})(?![\p{L}\p{M}\p{N}\p{Pd}_:/+±−]|[.,]\p{N})/gu;

function cardinal(value: number): string {
  if (value < 10) return digits[value];
  if (value === 10) return 'sepuluh';
  if (value === 11) return 'sebelas';
  if (value < 20) return digits[value - 10] + ' belas';
  if (value < 100) {
    const prefix = digits[Math.floor(value / 10)] + ' puluh';
    const remainder = value % 10;
    return remainder ? prefix + ' ' + digits[remainder] : prefix;
  }

  for (const [divisor, label] of magnitude) {
    if (value < divisor) continue;
    const count = Math.floor(value / divisor);
    const prefix = count === 1 && divisor <= 1_000 ? 'se' + label : cardinal(count) + ' ' + label;
    const remainder = value % divisor;
    return remainder ? prefix + ' ' + cardinal(remainder) : prefix;
  }
  throw new RangeError('Bilangan di luar rentang bacaan.');
}

function isAsciiDigit(text: string, index: number) {
  const code = text.charCodeAt(index);
  return code >= 48 && code <= 57;
}

export function normalizedReadout(text: string) {
  const normalized = text.normalize('NFC').toLocaleLowerCase('id-ID').trim().split(/\s+/u).join(' ').replace(/(?<!\.)\.$/u, '');
  return normalized
    .replace(clock, (clockText, rawHour: string, rawMinute: string) => {
      const hour = Number(rawHour);
      const minute = Number(rawMinute);
      if (hour > 23 || minute > 59) return clockText;
      const minutes = minute < 10 ? 'nol ' + digits[minute] : cardinal(minute);
      return 'pukul ' + cardinal(hour) + ' ' + minutes;
    })
    .replace(integer, (token, offset: number, source: string) => {
      const end = offset + token.length;
      if ((source[offset - 1] === ' ' && isAsciiDigit(source, offset - 2))
        || (source[end] === ' ' && isAsciiDigit(source, end + 1))) return token;
      const value = Number(token);
      if ((token.length > 1 && token[0] === '0') || !Number.isSafeInteger(value)) return token;
      return cardinal(value);
    });
}
