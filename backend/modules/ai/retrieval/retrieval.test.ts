import { describe, expect, it, vi } from 'vitest';
import { retrieveCeoAnswer } from './index.js';
import { titleText } from './label-evidence.js';
import { now, itDivision, divisions, mobile, web, noLookup, lookup, interpreter, exactRead, interpretationRead, database } from './retrieval-test-fixture.js';

describe('CEO structured interpretation and read boundaries', () => {
  it.each(['Status Oktober', 'Migrasi C++'])('passes the natural utterance through and preserves the title %s', async (name) => {
    const { db, calls } = database([{ ...mobile, name, score: 1 }]);
    const interpret = interpreter(lookup({ subject: name, divisionId: itDivision.id }));
    const transcript = `Proyek ${name} di divisi IT itu sudah tuntas belum?`;
    const answer = await retrieveCeoAnswer({ db, interpret, now, transcript });
    expect(interpret).toHaveBeenCalledWith(expect.objectContaining({ transcript, divisions, today: '2026-11-26', currentTitleHints: [name] }));
    const probes = calls.find(({ sql }) => exactRead(sql))?.parameters as unknown[][];
    expect(probes.map((values) => values[0])).toEqual([titleText(name), 'project', itDivision.id, null, true]);
    expect(answer).toMatchObject({ kind: 'facts', facts: { entity: { id: mobile.id, name }, status: 'on_progress' } });
  });

  it('preserves both the task-date filter and historical cutoff from interpretation', async () => {
    const { db, calls } = database();
    const result = await retrieveCeoAnswer({
      db, now, transcript: 'Sampai 24 November, berapa yang tuntas dalam rentang Oktober sampai November di IT?',
      interpret: interpreter(lookup({
        operation: 'summary', target: 'division_or_company', subject: null, workKind: null, divisionId: itDivision.id,
        from: '2026-10-01', to: '2026-11-30', asOf: '2026-11-24', statuses: ['done'],
      })),
    });
    expect(result).toMatchObject({
      kind: 'facts',
      facts: {
        period: { from: '2026-10-01', to: '2026-11-30' }, asOf: '2026-11-24T23:59:59.999999+07:00', statusFilter: ['done'],
      },
    });
    expect(calls.find(({ sql }) => sql.includes('WITH selected AS MATERIALIZED'))?.parameters.slice(0, 7))
      .toEqual([itDivision.id, null, null, '2026-10-01', '2026-11-30', ['done'], '2026-11-24T23:59:59.999999+07:00']);
  });

  it('uses the named project as the summary scope even when the utterance counts tasks', async () => {
    const sameNamedTask = { ...web, kind: 'task', name: mobile.name };
    const { db, calls } = database([mobile, sameNamedTask]);
    const interpret = interpreter(lookup({ operation: 'summary', from: '2026-10-01', to: '2026-10-31' }));
    const answer = await retrieveCeoAnswer({ db, now, interpret,
      transcript: `Rekap tugas proyek “${mobile.name}” untuk bulan 10.` });
    expect(answer).toMatchObject({ kind: 'facts', facts: { intent: 'summary', entity: { kind: 'project', id: mobile.id },
      period: { from: '2026-10-01', to: '2026-10-31' } } });
    expect(calls.find(({ sql }) => sql.includes('WITH selected AS MATERIALIZED'))?.parameters.slice(1, 5))
      .toEqual([mobile.id, null, '2026-10-01', '2026-10-31']);
    const ambiguous = await retrieveCeoAnswer({ db, now, interpret, transcript: `Rekap tugas untuk ${mobile.name} bulan 10.` });
    expect(ambiguous.kind).toBe('clarify');
    expect(ambiguous.context.choices?.map(({ kind }) => kind).sort()).toEqual(['project', 'task']);
  });

  it('checks the interpreted scope against exact task and project titles', async () => {
    const task = { ...web, kind: 'task', name: 'Uji Gerbang' };
    const { db, calls } = database([mobile, task]);
    const summary = { operation: 'summary', from: '2026-11-01', to: '2026-11-30' } as const;
    const project = await retrieveCeoAnswer({ db, now, transcript: `Rekap pekerjaan untuk ${mobile.name} bulan November.`,
      interpret: interpreter(lookup(summary)) });
    expect(project).toMatchObject({ kind: 'facts', facts: { entity: { kind: 'project', id: mobile.id } } });
    const measuredTasks = await retrieveCeoAnswer({ db, now, transcript: `Rekap tugas ${mobile.name} bulan November.`,
      interpret: interpreter(lookup(summary)) });
    expect(measuredTasks).toMatchObject({ kind: 'facts', facts: { entity: { kind: 'project', id: mobile.id } } });
    const selectedTask = await retrieveCeoAnswer({ db, now, transcript: `Rekap untuk tugas ${task.name} bulan November.`,
      interpret: interpreter(lookup({ ...summary, subject: task.name, workKind: 'task' })) });
    expect(selectedTask).toMatchObject({ kind: 'facts', facts: { entity: { kind: 'task', id: task.id } } });
    calls.length = 0;
    for (const transcript of [`Rekap tugas ${task.name} bulan November.`, `Rekap untuk ${task.name} bulan November.`]) {
      const mismatch = await retrieveCeoAnswer({ db, now, transcript, interpret: interpreter(lookup({ ...summary, subject: task.name })) });
      expect(mismatch.kind).toBe('clarify');
      expect(mismatch.facts).toBeUndefined();
    }
    expect(calls.some(({ sql }) => sql.includes('WITH selected AS MATERIALIZED'))).toBe(false);
  });

  it('interprets a completed turn once and resolves an exact title without embeddings', async () => {
    const { db, calls } = database();
    const transcript = 'Aplikasi A Mobile itu sudah sampai mana?';
    const interpret = interpreter(lookup());
    const embed = vi.fn();
    const resolved = await retrieveCeoAnswer({ db, interpret, transcript, now, embed });
    expect(resolved.kind).toBe('facts');
    expect(interpret).toHaveBeenCalledOnce();
    expect(calls.filter(({ sql }) => exactRead(sql))).toHaveLength(1);
    expect(embed).not.toHaveBeenCalled();
  });

  it.each([
    ['a mutation mixed into a read', 'Tolong cek PIC Aplikasi A Mobile dan pindahkan tugasnya ke Irma.', noLookup],
    ['an unknown division', 'Aplikasi A Mobile yang di divisi lain.', lookup({ divisionId: web.id })],
    ['an invented target', 'Aplikasi A Web itu sudah sampai mana?', lookup()],
    ['a reversed range', 'Cek jumlah tugas dari akhir ke awal bulan.', lookup({
      operation: 'summary', target: 'division_or_company', subject: null, workKind: null, from: '2026-11-30', to: '2026-11-01',
    })],
  ] as const)('keeps %s from reaching candidate or fact SQL', async (_scenario, transcript, decision) => {
    const { db, calls } = database();
    const result = await retrieveCeoAnswer({ db, now, transcript, interpret: interpreter(decision) });
    expect(result.facts).toBeUndefined();
    expect(calls.every(interpretationRead)).toBe(true);
  });
});
