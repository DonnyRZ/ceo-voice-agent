import { describe, expect, it } from 'vitest';
import { retrieveCeoAnswer } from './index.js';
import { now, itDivision, finance, mobile, web, lookup, interpreter, exactRead, interpretationRead, database } from './retrieval-test-fixture.js';

describe('CEO confirmed context and scope corrections', () => {
  it('uses the last authorized entity and preserves the Jakarta timestamp on a follow-up', async () => {
    const { db, calls } = database();
    const interpret = interpreter(lookup({ divisionId: itDivision.id }));
    const initial = await retrieveCeoAnswer({ db, interpret, now, transcript: 'Aplikasi A Mobile di IT itu sudah sampai mana?' });
    expect(initial.kind).toBe('facts');
    calls.length = 0;
    const history = [{ role: 'user' as const, text: 'Aplikasi A Mobile itu sudah sampai mana?' }];
    const updatedInterpreter = interpreter(lookup({ operation: 'updated_at', target: 'previous_work', subject: null, workKind: null }));
    const updated = await retrieveCeoAnswer({
      db, interpret: updatedInterpreter, now, transcript: 'Terakhir orang sentuh catatannya pukul berapa?', history, context: initial.context,
    });
    expect(updatedInterpreter).toHaveBeenCalledWith(expect.objectContaining({ history, context: initial.context }));
    expect(updated).toMatchObject({ kind: 'facts', facts: { entity: { id: mobile.id }, updatedAt: now.toISOString() } });
    expect(updated.text).toContain('26 November 2026');
    expect(updated.text).toContain('08.30 WIB');
    expect(calls.some(({ sql }) => exactRead(sql))).toBe(false);
    expect(calls.find(({ sql }) => sql.includes('work.status'))?.parameters).toEqual([mobile.id, itDivision.id]);
  });

  it('resolves the title again when the CEO corrects its division', async () => {
    const sameTitle = { ...mobile, id: web.id, divisionId: finance.id, divisionName: finance.name };
    const { db, calls } = database([mobile, sameTitle]);
    const interpret = interpreter(lookup({ divisionId: itDivision.id }));
    const initial = await retrieveCeoAnswer({ db, interpret, now, transcript: 'Aplikasi A Mobile cabang IT sudah sampai mana?' });
    expect(initial).toMatchObject({ kind: 'facts', facts: { entity: { id: mobile.id } } });

    calls.length = 0;
    interpret.mockResolvedValue(lookup({
      target: 'previous_work', subject: null, workKind: null, divisionId: finance.id,
    }));
    const corrected = await retrieveCeoAnswer({ db, interpret, now, transcript: 'Yang di Finance sebenarnya.', context: initial.context });
    expect(corrected).toMatchObject({ kind: 'facts', facts: { entity: { id: sameTitle.id } } });
    expect(calls.find(({ sql }) => sql.includes('work.status'))?.parameters).toEqual([sameTitle.id, finance.id]);
  });

  it('accepts the verified Finance scope echoed on a PIC follow-up without a spoken division', async () => {
    const task = { ...mobile, kind: 'task', name: 'Rekonsiliasi transaksi', divisionId: finance.id,
      divisionName: finance.name, picName: 'Laura' };
    const { db, calls } = database([task]);
    const first = await retrieveCeoAnswer({ db, now, transcript: `Apa status tugas ${task.name}?`,
      interpret: interpreter(lookup({ subject: task.name, workKind: 'task' })) });
    expect(first.kind).toBe('facts');
    expect(first.context.request?.division).toBeUndefined();
    expect(first.context.request?.entityDivisionId).toBe(finance.id);

    const followUp = (divisionId: string, subject: string | null,
      transcript = 'Kalau tugas yang tadi, siapa penanggung jawabnya?', context = first.context) =>
      retrieveCeoAnswer({ db, now, transcript, context, interpret: interpreter(lookup({
        target: 'previous_work', operation: 'pic', workKind: 'task', subject, divisionId,
      })) });

    calls.length = 0;
    for (const subject of [null, task.name]) {
      const answer = await followUp(finance.id, subject);
      expect(answer).toMatchObject({ kind: 'facts', facts: { intent: 'pic', entity: { id: task.id }, picName: 'Laura' } });
    }
    expect(calls.filter(({ sql }) => sql.includes('WITH selected AS MATERIALIZED')).map(({ parameters }) => parameters.slice(0, 3)))
      .toEqual([[finance.id, null, task.id], [finance.id, null, task.id]]);

    calls.length = 0;
    const wrongScope = await followUp(itDivision.id, null);
    const differentSpokenScope = await followUp(finance.id, null, 'Siapa penanggung jawab tugas tadi di IT?');
    const pending = await followUp(finance.id, null, undefined, { pendingRequest: first.context.request });
    expect([wrongScope, differentSpokenScope, pending].map(({ kind }) => kind)).toEqual(['clarify', 'clarify', 'clarify']);
    expect(calls.every(interpretationRead)).toBe(true);
  });

  it('keeps the confirmed operation and resolves an echoed title in a corrected division', async () => {
    const financeProject = { ...mobile, id: 'ea0e00b0-301c-4000-8000-000000000102', name: 'Sinkronisasi Arsip',
      divisionId: finance.id, divisionName: finance.name, status: 'on_progress' };
    const itProject = { ...mobile, id: 'ea0e00b0-301c-4000-8000-000000000101', name: financeProject.name, status: 'pending' };
    const { db, calls } = database([financeProject, itProject]);
    const first = await retrieveCeoAnswer({ db, now, transcript: 'Apa status proyek Sinkronisasi Arsip di divisi Finance?',
      interpret: interpreter(lookup({ subject: financeProject.name, divisionId: finance.id })) });
    expect(first).toMatchObject({ kind: 'facts', facts: { entity: { id: financeProject.id } } });
    calls.length = 0;
    const corrected = await retrieveCeoAnswer({ db, now, transcript: 'Yang di divisi IT sebenarnya.', context: first.context,
      interpret: interpreter(lookup({ target: 'previous_work', operation: null, subject: 'ＳINKRONISASI  ARSIP', divisionId: itDivision.id })) });
    expect(corrected).toMatchObject({ kind: 'facts', facts: { intent: 'status', entity: { id: itProject.id }, status: 'pending' } });
    expect(calls.find(({ sql }) => sql.includes('work.status'))?.parameters).toEqual([itProject.id, itDivision.id]);
  });

  it('rejects a replacement title, a conflicting kind, or an unconfirmed echo as a previous work item', async () => {
    const { db, calls } = database([mobile, web]);
    const first = await retrieveCeoAnswer({ db, now, transcript: 'Status proyek Aplikasi A Mobile?', interpret: interpreter(lookup()) });
    const pending = await retrieveCeoAnswer({ db, now, transcript: 'Status proyek Aplikasi A?', context: first.context,
      interpret: interpreter(lookup({ subject: 'Aplikasi A' })) });
    calls.length = 0;
    for (const [transcript, subject, context] of [
      ['Maksud saya proyek Aplikasi A Web.', web.name, first.context],
      ['Status tugas tadi?', mobile.name, first.context],
      ['Status yang tadi?', 'Aplikasi A', pending.context],
    ] as const) {
      const answer = await retrieveCeoAnswer({ db, now, transcript, context,
        interpret: interpreter(lookup({ target: 'previous_work', subject, workKind: null })) });
      expect(answer.kind).toBe('clarify');
      expect(answer.facts).toBeUndefined();
    }
    expect(calls.every(interpretationRead)).toBe(true);
  });

  it('retains the summary operation when the CEO corrects only the period or division', async () => {
    const { db, calls } = database();
    const first = await retrieveCeoAnswer({ db, now, transcript: 'Berapa tugas selesai di IT pada November?',
      interpret: interpreter(lookup({ operation: 'summary', target: 'division_or_company', subject: null, workKind: 'task',
        divisionId: itDivision.id, from: '2026-11-01', to: '2026-11-30', statuses: ['done'] })) });
    expect(first).toMatchObject({ kind: 'facts', facts: { entity: { kind: 'division', id: itDivision.id } } });
    const period = await retrieveCeoAnswer({ db, now, transcript: 'Maksud saya Oktober saja.', context: first.context,
      interpret: interpreter(lookup({ operation: null, target: 'previous_work', subject: null, workKind: null,
        from: '2026-10-01', to: '2026-10-31' })) });
    expect(period).toMatchObject({ kind: 'facts', facts: { intent: 'summary', entity: { id: itDivision.id },
      period: { from: '2026-10-01', to: '2026-10-31' }, statusFilter: ['done'] } });
    calls.length = 0;
    const division = await retrieveCeoAnswer({ db, now, transcript: 'Yang dari Finance.', context: period.context,
      interpret: interpreter(lookup({ operation: null, target: 'previous_work', subject: null, workKind: null, divisionId: finance.id })) });
    expect(division).toMatchObject({ kind: 'facts', facts: { intent: 'summary', entity: { id: finance.id },
      period: { from: '2026-10-01', to: '2026-10-31' }, statusFilter: ['done'] } });
    expect(calls.find(({ sql }) => sql.includes('WITH selected AS MATERIALIZED'))?.parameters.slice(0, 7))
      .toEqual([finance.id, null, null, '2026-10-01', '2026-10-31', ['done'], null]);
  });
});
