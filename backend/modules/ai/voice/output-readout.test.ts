import { describe, expect, it } from 'vitest';
import { normalizedReadout } from './output-readout.js';

describe('bacaan bilangan keluaran Voice Agent', () => {
  it('menyamakan tanggal dan jam dari probe dengan bacaan Bahasa Indonesia', () => {
    const canonical = 'Terakhir diperbarui 14 Oktober 2026 pukul 13.15 WIB, untuk tugas Buka Ruang Uji di divisi IT.';
    const spoken = 'Terakhir diperbarui empat belas Oktober dua ribu dua puluh enam pukul tiga belas lima belas WIB, untuk tugas Buka Ruang Uji di divisi IT';
    expect(normalizedReadout(canonical)).toBe(normalizedReadout(spoken));
    expect(normalizedReadout(canonical.replace('13.15', '13:15'))).toBe(normalizedReadout(spoken));
  });

  it.each([
    ['13.05', 'tiga belas nol lima'],
    ['13:00', 'tiga belas nol nol'],
    ['00.00', 'nol nol nol'],
    ['07.59', 'tujuh lima puluh sembilan'],
  ])('mempertahankan setiap digit menit pada pukul %s', (time, words) => {
    expect(normalizedReadout(`Pukul ${time} WIB.`)).toBe(`pukul ${words} wib`);
  });

  it.each([
    [0, 'nol'], [10, 'sepuluh'], [11, 'sebelas'], [14, 'empat belas'], [42, 'empat puluh dua'],
    [100, 'seratus'], [119, 'seratus sembilan belas'], [1_000, 'seribu'], [2_026, 'dua ribu dua puluh enam'],
    [1_201_000, 'satu juta dua ratus satu ribu'],
  ])('membaca bilangan bulat berdiri sendiri %s', (value, words) => {
    expect(normalizedReadout(`Ada ${value} tugas.`)).toBe(`ada ${words} tugas`);
  });

  it.each([
    '1.500', '1,500', '1 500', '1 234 567', '0.25', '.25', '2026-10-14', '14/10/2026',
    'ab12', '12b', 'r-12', '1_2', '01', '9007199254740992', '-12', '+12', '−12',
    'pukul 24.00', 'pukul 13.60', 'pukul 13:15:00', 'pukul 8.05',
  ])('membiarkan token non-standar %s', (text) => {
    expect(normalizedReadout(text)).toBe(text);
  });

  it.each([
    'Ada dua belas tugas tambahan.',
    'Ada tiga belas tugas.',
    'Ada minus dua belas tugas.',
    'Ada -12 tugas.',
    'Ada −12 tugas.',
    'Tidak ada dua belas tugas.',
  ])('tetap membedakan kata, nilai, dan tanda pada %s', (spoken) => {
    expect(normalizedReadout(spoken)).not.toBe(normalizedReadout('Ada 12 tugas.'));
  });

  it('membedakan menit nol dari menit yang dihilangkan atau berubah', () => {
    const readout = normalizedReadout('Pukul 13.05 WIB.');
    for (const alternative of [
      'Pukul tiga belas WIB.', 'Pukul tiga belas lima WIB.', 'Pukul 13.00 WIB.', 'Pukul 13.50 WIB.',
    ]) {
      expect(normalizedReadout(alternative)).not.toBe(readout);
    }
  });

  it('melonggarkan kapitalisasi, spasi dan satu titik akhir', () => {
    expect(normalizedReadout('  ADA\n 12   tugas. ')).toBe('ada dua belas tugas');
    expect(normalizedReadout('Ada 12 tugas..')).toBe('ada dua belas tugas..');
    expect(normalizedReadout('Ada 12 tugas...')).toBe('ada dua belas tugas...');
    expect(normalizedReadout('Ada 12 tugas?')).toBe('ada dua belas tugas?');
  });
});
