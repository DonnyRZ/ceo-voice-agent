const segmenter = new Intl.Segmenter('id', { granularity: 'word' });

export function wordsOf(input: string) {
  return Array.from(segmenter.segment(input.normalize('NFKC').toLocaleLowerCase('id-ID')))
    .filter(({ isWordLike }) => isWordLike)
    .map(({ segment }) => segment)
    .slice(0, 160);
}

export function normalized(input: string) {
  return wordsOf(input).join(' ');
}

export function phraseIndex(words: string[], phrase: string[], start = 0) {
  return words.findIndex((_, index) => index >= start && phrase.every((token, offset) => words[index + offset] === token));
}

const digitWords = ['nol', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan'];

export function readNumber(words: string[], index: number): { value: number; length: number } | undefined {
  const word = words[index];
  if (!word) return;
  const numeric = Number(word);
  if (Number.isSafeInteger(numeric) && [...word].every((character) => character >= '0' && character <= '9')) return { value: numeric, length: 1 };
  if (word === 'sepuluh') return { value: 10, length: 1 };
  if (word === 'sebelas') return { value: 11, length: 1 };

  const unit = digitWords.indexOf(word);
  if (unit < 0) return;
  if (words[index + 1] === 'belas') return { value: unit + 10, length: 2 };
  if (words[index + 1] === 'puluh') {
    const extra = digitWords.indexOf(words[index + 2]);
    return { value: unit * 10 + Math.max(extra, 0), length: extra >= 0 ? 3 : 2 };
  }
  return { value: unit, length: 1 };
}
