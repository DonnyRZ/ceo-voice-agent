import { describe, expect, it } from 'vitest';
import { catalogueTitleProbes, titleEvidence, withoutDivisionOverlap } from './label-evidence.js';

describe('literal title boundaries in speech transcripts', () => {
  it.each(['“', '"', '‘'])('accepts a complete trailing subject after an unfinished %s quote', (quote) => {
    for (const subject of ['Pelabuhan Selatan', 'Migrasi O’Neil', 'Rencana Pasca-Panen']) {
      for (const ending of ['', '?', '.  ']) {
        const evidence = titleEvidence(`Cek status proyek ${quote} ${subject}${ending}`, subject);
        expect(evidence?.selected.text).toBe(subject.toLocaleLowerCase('id-ID'));
      }
    }
  });

  it('preserves punctuation that belongs to the requested title', () => {
    const evidence = titleEvidence('Cek proyek “Rencana v2.0!', 'Rencana v2.0!');
    expect(evidence?.selected.text).toBe('rencana v2.0!');
  });

  it.each([
    ['Cek proyek “Pelabuhan Selatan Baru', 'Pelabuhan Selatan'],
    ['Cek proyek “Pelabuhan Selatan di IT', 'Pelabuhan Selatan'],
    ['Cek proyek “Pelabuhan Selatan lalu proyek lain', 'Pelabuhan Selatan'],
    ['Cek proyek “Pelabuhan Selatan atau Pelabuhan Selatan', 'Pelabuhan Selatan'],
    ['Cek proyek “"Pelabuhan Selatan', 'Pelabuhan Selatan'],
    ['Cek proyek “”Pelabuhan Selatan', 'Pelabuhan Selatan'],
  ])('keeps the title unresolved when an unfinished quote has uncertain scope in %s', (transcript, subject) => {
    expect(titleEvidence(transcript, subject)).toBeUndefined();
  });

  it('retains strict quote handling for catalogue hints and division trimming', () => {
    const transcript = 'Cek proyek “Pelabuhan Selatan Khusus di divisi Finance';
    expect(catalogueTitleProbes(transcript)).toBeUndefined();
    expect(withoutDivisionOverlap(transcript, 'Pelabuhan Selatan Khusus', 'Khusus di divisi Finance', {
      id: 'ea0e00b0-101c-4000-8000-000000000002', name: 'Finance', code: 'FIN',
    })).toBe('Pelabuhan Selatan Khusus');
  });
});
