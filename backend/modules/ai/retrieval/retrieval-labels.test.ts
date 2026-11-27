import { describe, expect, it, vi } from 'vitest';
import { retrieveCeoAnswer } from './index.js';
import { now, itDivision, finance, mobile, web, lookup, interpreter, exactRead, interpretationRead, database } from './retrieval-test-fixture.js';

describe('CEO official labels and exact title boundaries', () => {
  it('resolves a full spoken title when the interpreter includes its type marker', async () => {
    const { db, calls } = database();
    const embed = vi.fn();
    const result = await retrieveCeoAnswer({ db, now, transcript: 'Status proyek Aplikasi A Mobile di IT?', embed,
      interpret: interpreter(lookup({ subject: 'proyek Aplikasi A Mobile', divisionId: itDivision.id })) });
    expect(result).toMatchObject({ kind: 'facts', facts: { entity: { id: mobile.id } } });
    expect(calls.filter(({ sql }) => exactRead(sql))).toHaveLength(2);
    expect(embed).not.toHaveBeenCalled();
  });

  it('does not use a type wrapper to choose between two official labels or an ungrounded synonym', async () => {
    const rival = { ...web, name: 'Proyek Aplikasi A Mobile' };
    const { db, calls } = database([mobile, rival]);
    const named = await retrieveCeoAnswer({ db, now, transcript: 'Status proyek Aplikasi A Mobile?',
      interpret: interpreter(lookup({ subject: rival.name })) });
    expect(named.kind).toBe('clarify');
    expect(named.facts).toBeUndefined();
    const partial = await retrieveCeoAnswer({ db, now, transcript: 'Status proyek Aplikasi A?',
      interpret: interpreter(lookup({ subject: 'proyek Aplikasi A' })) });
    expect(partial.kind).toBe('clarify');
    expect(partial.facts).toBeUndefined();
    expect(calls.some(({ sql }) => sql.includes('work.status'))).toBe(false);
  });

  it('does not treat a type wrapper as authorization to return the other kind of work', async () => {
    const rival = { ...web, kind: 'task', name: 'Proyek Aplikasi A Mobile' };
    const { db, calls } = database([rival]);
    const result = await retrieveCeoAnswer({ db, now, transcript: 'Status proyek Aplikasi A Mobile?',
      interpret: interpreter(lookup({ subject: rival.name })) });
    expect(result.kind).toBe('clarify');
    expect(result.facts).toBeUndefined();
    expect(calls.some(({ sql }) => sql.includes('work.status'))).toBe(false);
  });

  it('does not auto-answer a shorter official title when a longer title also appears', async () => {
    const shorter = { ...web, name: 'Aplikasi A' };
    const { db, calls } = database([shorter, mobile]);
    const result = await retrieveCeoAnswer({ db, now, transcript: 'Status proyek Aplikasi A Mobile?',
      interpret: interpreter(lookup({ subject: shorter.name })) });
    expect(result.kind).toBe('clarify');
    expect(result.context.choices?.map(({ id }) => id)).toEqual([shorter.id, mobile.id]);
    expect(calls.some(({ sql }) => sql.includes('work.status'))).toBe(false);
  });

  it('checks whether a division mention is also part of a longer official title', async () => {
    const fullyNamed = { ...mobile, name: 'Integrasi di Finance' };
    const scoped = { ...web, name: 'Integrasi', divisionId: finance.id, divisionName: finance.name };
    const { db, calls } = database([fullyNamed, scoped]);
    const result = await retrieveCeoAnswer({ db, now, transcript: 'Status proyek Integrasi di Finance?',
      interpret: interpreter(lookup({ subject: scoped.name, divisionId: finance.id })) });
    expect(result.kind).toBe('clarify');
    expect(result.context.choices).toBeUndefined();
    expect(calls.some(({ sql }) => sql.includes('work.status'))).toBe(false);
  });

  it('keeps a quoted full title when the proposed division scope starts inside the quote', async () => {
    const short = { ...mobile, name: 'Sinkronisasi Arsip', divisionId: finance.id, divisionName: finance.name };
    const longer = { ...short, id: web.id, name: 'Sinkronisasi Arsip Khusus' };
    const { db } = database([short, longer]);
    const answer = await retrieveCeoAnswer({ db, now, transcript: `Apa status proyek “${longer.name}” di divisi Finance?`,
      interpret: interpreter(lookup({ subject: longer.name, divisionId: finance.id, divisionExcerpt: 'Khusus” di divisi Finance' })) });
    expect(answer).toMatchObject({ kind: 'facts', facts: { entity: { id: longer.id } } });
  });

  it('queries the full trailing title when transcription omits a closing quote', async () => {
    const name = 'Pelabuhan Selatan';
    for (const registered of [true, false]) {
      const { db, calls } = database(registered ? [{ ...mobile, name }] : [], []);
      const answer = await retrieveCeoAnswer({ db, now, transcript: `Apa status proyek “${name}?`,
        interpret: interpreter(lookup({ subject: name })) });
      expect(calls.some(({ sql }) => exactRead(sql))).toBe(true);
      expect(answer.kind).toBe(registered ? 'facts' : 'no_match');
      if (answer.kind === 'facts') expect(answer.facts.entity).toMatchObject({ id: mobile.id, name });
    }
  });

  it('uses canonical formatting for exact titles and preserves meaningful symbols', async () => {
    const named = { ...mobile, name: 'Ｓistem—Log C#' };
    const near = { ...web, name: 'Sistem Log C++' };
    const { db } = database([named, near]);
    const result = await retrieveCeoAnswer({ db, now, transcript: 'Status proyek Sistem Log C#?',
      interpret: interpreter(lookup({ subject: 'Sistem Log C#' })) });
    expect(result).toMatchObject({ kind: 'facts', facts: { entity: { id: named.id, name: named.name } } });
  });

  it('rejects invented division and does not use a guessed kind to hide a namesake', async () => {
    const task = { ...web, kind: 'task', name: mobile.name };
    const { db, calls } = database([mobile, task]);
    const scope = await retrieveCeoAnswer({ db, now, transcript: 'Status Aplikasi A Mobile?',
      interpret: interpreter(lookup({ divisionId: itDivision.id })) });
    expect(scope.kind).toBe('clarify');
    expect(calls.every(interpretationRead)).toBe(true);
    const kind = await retrieveCeoAnswer({ db, now, transcript: 'Status Aplikasi A Mobile?', interpret: interpreter(lookup()) });
    expect(kind.kind).toBe('clarify');
    expect(kind.context.choices?.map(({ kind }) => kind).sort()).toEqual(['project', 'task']);
  });

  it('uses a structured work kind for unmarked phrasing and validates it against a literal match', async () => {
    const task = { ...web, kind: 'task', name: 'Uji Gerbang', status: 'done', picName: 'Doni' };
    const { db, calls } = database([mobile, task]);
    const status = await retrieveCeoAnswer({ db, now, transcript: `Sudah sampai mana ${mobile.name} setelah tugas persiapan selesai?`,
      interpret: interpreter(lookup()) });
    expect(status).toMatchObject({ kind: 'facts', facts: { entity: { kind: 'project', id: mobile.id } } });
    const responsibility = await retrieveCeoAnswer({ db, now, transcript: `Siapa yang sekarang menangani ${task.name}?`,
      interpret: interpreter(lookup({ operation: 'pic', workKind: 'task', subject: task.name })) });
    expect(responsibility).toMatchObject({ kind: 'facts', facts: { entity: { kind: 'task', id: task.id }, picName: 'Doni' } });
    calls.length = 0;
    const wrong = await retrieveCeoAnswer({ db, now, transcript: `Siapa yang sekarang menangani ${task.name}?`,
      interpret: interpreter(lookup({ operation: 'pic', workKind: 'project', subject: task.name })) });
    expect(wrong.kind).toBe('clarify');
    expect(wrong.facts).toBeUndefined();
    expect(calls.some(({ sql }) => sql.includes('WITH selected AS MATERIALIZED') || sql.includes('work.status'))).toBe(false);
  });

  it('keeps suggestions in the interpreted kind for a description without a fixed type marker', async () => {
    const named = { ...mobile, name: 'Pemulihan Layanan Pesan', score: 0.62 };
    const similarlyDescribedTask = { ...web, kind: 'task', name: 'Pencadangan Surel', score: 0.67 };
    const { db, calls } = database([named, similarlyDescribedTask], []);
    const answer = await retrieveCeoAnswer({ db, now, transcript: 'Bagaimana kemajuan upaya agar surel karyawan bisa dipulihkan?',
      interpret: interpreter(lookup({ subject: 'upaya agar surel karyawan bisa dipulihkan' })) });
    expect(answer.kind).toBe('clarify');
    expect(answer.context.choices?.map(({ id }) => id)).toEqual([named.id]);
    expect(calls.filter(({ sql }) => sql.includes('ceo_search_work')).map(({ parameters }) => parameters[0])).toEqual(['project']);
  });
});
