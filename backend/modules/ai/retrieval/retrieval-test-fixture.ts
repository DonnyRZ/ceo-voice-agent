import type { QueryResultRow } from 'pg';
import { vi } from 'vitest';
import type { CeoInterpretation, InterpretCeoTurn } from './interpretation.js';
import { titleText } from './label-evidence.js';
import type { RetrievalDatabase } from './schema.js';

export const now = new Date('2026-11-26T01:30:00.000Z');
export const itDivision = { id: 'ea0e00b0-101c-4000-8000-000000000001', name: 'IT', code: 'IT' };
export const finance = { id: 'ea0e00b0-101c-4000-8000-000000000002', name: 'Finance', code: 'FIN' };
export const divisions = [itDivision, finance];
export const mobile = { kind: 'project', id: 'ea0e00b0-301c-4000-8000-000000000001', name: 'Aplikasi A Mobile', divisionName: 'IT', divisionId: itDivision.id, score: 1 };
export const web = { ...mobile, id: 'ea0e00b0-301c-4000-8000-000000000002', name: 'Aplikasi A Web', score: 0.82 };
export const empty = { pending: 0, on_progress: 0, done: 0, total: 0 };
export const noLookup: CeoInterpretation = {
  kind: 'unsupported', operation: null, target: null, workKind: null, subject: null, divisionId: null,
  from: null, to: null, asOf: null, statuses: [], selectionId: null, clarify: null,
};

export function lookup(fields: Partial<CeoInterpretation> = {}): CeoInterpretation {
  return { ...noLookup, kind: 'lookup', operation: 'status', target: 'named_work', workKind: 'project', subject: mobile.name, ...fields };
}

export function interpreter(decision: CeoInterpretation) {
  return vi.fn<InterpretCeoTurn>().mockResolvedValue(decision);
}

export type TestCandidate = typeof mobile & { status?: string; historicalStatus?: string; recordedSince?: string; picName?: string };

export const hintRead = (sql: string) => sql.includes('SELECT DISTINCT matched.name');
export const exactRead = (sql: string) => sql.includes('WITH grouped AS');
export const interpretationRead = ({ sql }: { sql: string }) => sql.includes('SELECT id, name, code') || hintRead(sql);
export const recordedBy = ({ recordedSince }: TestCandidate, cutoff: unknown) =>
  !recordedSince || typeof cutoff !== 'string' || recordedSince <= cutoff;

export function database(candidates: TestCandidate[] = [mobile], semantic = [{ ...mobile, score: 0.82 }]) {
  const calls: { sql: string; parameters: unknown[] }[] = [];
  const db: RetrievalDatabase = {
    async query<Row extends QueryResultRow>(sql: string, parameters: unknown[] = []) {
      calls.push({ sql, parameters });
      let rows: unknown[];
      if (sql.includes('SELECT id, name, code')) rows = divisions;
      else if (hintRead(sql)) {
        const [probes] = parameters as [string[]];
        const names = new Set(candidates.filter(({ name }) => probes.includes(titleText(name))).map(({ name }) => name));
        rows = [...names].sort((left, right) => right.length - left.length || left.localeCompare(right))
          .slice(0, 8).map((name) => ({ name }));
      }
      else if (exactRead(sql)) {
        const [probes, kinds, divisionIds, cutoffs, primary] = parameters as [
          string[], (string | null)[], (string | null)[], (string | null)[], boolean[],
        ];
        rows = probes.flatMap((probe, index) => candidates.filter((candidate) =>
          (!kinds[index] || candidate.kind === kinds[index]) && (!divisionIds[index] || candidate.divisionId === divisionIds[index])
          && recordedBy(candidate, cutoffs[index])
          && titleText(candidate.name) === titleText(probe)).map((candidate) => ({ ...candidate, primary: primary[index],
          sameScope: kinds[index] === kinds[0] && divisionIds[index] === divisionIds[0] && cutoffs[index] === cutoffs[0] })));
      }
      else if (sql.includes('ceo_search_work')) rows = candidates.filter((candidate) =>
        candidate.kind === parameters[0] && (!parameters[2] || candidate.divisionId === parameters[2])
        && recordedBy(candidate, parameters[3]));
      else if (sql.includes('work_search_embeddings')) rows = semantic;
      else if (sql.includes('WITH selected AS MATERIALIZED')) {
        const selected = candidates.find(({ id, kind, divisionId }) =>
          kind === 'task' && id === parameters[2] && (!parameters[0] || divisionId === parameters[0]));
        rows = [{ counts: empty, tasks: selected ? [{
          id: selected.id, title: selected.name, projectId: mobile.id, projectName: mobile.name,
          divisionId: selected.divisionId, divisionName: selected.divisionName, date: '2026-11-26',
          status: selected.status ?? 'on_progress', picName: selected.picName ?? null, updatedAt: now,
        }] : [] }];
      }
      else if (sql.includes('work.status') || sql.includes('FROM public.ceo_work_status_as_of(')) {
        const historical = sql.includes('FROM public.ceo_work_status_as_of(');
        const selected = candidates.find(({ id, divisionId }) =>
          id === parameters[historical ? 1 : 0] && (!parameters[historical ? 3 : 1] || divisionId === parameters[historical ? 3 : 1]));
        rows = selected ? [{ status: (historical ? selected.historicalStatus : selected.status) ?? 'on_progress',
          name: selected.name, divisionName: selected.divisionName, updatedAt: now }] : [];
      }
      else throw new Error('Unexpected SQL in fake DB.');
      return { rows: rows as Row[] };
    },
  };
  return { db, calls };
}
