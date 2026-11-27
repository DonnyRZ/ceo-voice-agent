import { divisionsIn } from './division-scope.js';
import { catalogueTitleProbes, inside, outsideSpan, titleEvidence, titleText, titleTypeMarker, workTitleMarker, type TitleSpan } from './label-evidence.js';
import { searchLexical } from './lexical.js';
import type { CeoRequest, DivisionRef, PresentedChoice, WorkKind } from './request-types.js';
import type { CeoEntity, RetrievalDatabase } from './schema.js';
import { cleanLabel } from './speech.js';

type Candidate = CeoEntity & { divisionId: string; score: number; source: 'exact' | 'lexical' | 'semantic' };
type SearchRow = Omit<Candidate, 'source'>;
export type EmbedText = (text: string, signal: AbortSignal) => Promise<{ model: string; vector: number[] }>;

type ExactRow = PresentedChoice & { primary: boolean; sameScope: boolean };
type SpanProbe = { title: string; kind?: WorkKind; divisionId?: string; cutoff?: string; primary: boolean };
type Utterance = { transcript: string; divisions: DivisionRef[]; superseded?: TitleSpan };
type ExactResult = { candidates: PresentedChoice[]; complete: boolean; alternateMatch?: boolean };

export async function readLiteralTitleHints(db: RetrievalDatabase, transcript: string) {
  const titles = catalogueTitleProbes(transcript);
  if (!titles?.length) return [];
  const { rows } = await db.query<{ name: string }>(`
    SELECT name FROM (
      SELECT DISTINCT matched.name
      FROM public.ceo_exact_work_labels($1::text[], NULL, NULL, NULL) AS matched
      WHERE length(matched.name) <= 250
    ) AS titles
    ORDER BY length(name) DESC, name
    LIMIT 8`, [titles]);
  return rows.map(({ name }) => name);
}

async function searchExactSpans(db: RetrievalDatabase, request: CeoRequest, utterance?: Utterance,
  activeOnly = false): Promise<ExactResult> {
  if (!request.subject) return { candidates: [], complete: false };
  const evidence = utterance && titleEvidence(utterance.transcript, request.subject);
  if (utterance && !evidence) return { candidates: [], complete: false };
  const marker = evidence && titleTypeMarker(evidence.text, evidence.selected);
  // An interpretation can scope suggestions, but it cannot hide an exact namesake in another kind.
  const provedKind = !evidence || marker === request.entityKind ? request.entityKind : undefined;
  const probes: SpanProbe[] = [{ title: request.subject, kind: provedKind,
    divisionId: request.division?.id, cutoff: request.asOf, primary: true }];
  if (evidence && utterance) {
    for (const span of evidence.probes) {
      if (utterance.superseded && inside(span, utterance.superseded)) continue;
      const outside = outsideSpan(evidence.text, span, utterance.superseded);
      const spanMarker = titleTypeMarker(evidence.text, span);
      const comparableKind = spanMarker === request.entityKind ? request.entityKind : undefined;
      const divisions = divisionsIn(outside, utterance.divisions);
      const divisionId = divisions.length === 1 ? divisions[0].id : undefined;
      if (inside(span, evidence.selected) && comparableKind === provedKind && divisionId === request.division?.id) continue;
      probes.push({ title: span.text, kind: comparableKind, divisionId, cutoff: request.asOf, primary: false });
      if (request.asOf && inside(evidence.selected, span) && !inside(span, evidence.selected)) {
        probes.push({ title: span.text, kind: comparableKind, divisionId, primary: false });
      }
      if (probes.length > 2048) return { candidates: [], complete: false };
    }
  }
  const { rows } = await db.query<ExactRow>(`
    WITH grouped AS (
      SELECT work_kind, scope_id, cutoff, is_primary, array_agg(DISTINCT title) AS titles
      FROM unnest($1::text[], $2::text[], $3::uuid[], $4::timestamptz[], $5::boolean[])
        AS probe(title, work_kind, scope_id, cutoff, is_primary)
      GROUP BY work_kind, scope_id, cutoff, is_primary
    )
    SELECT grouped.is_primary AS "primary", kind, id::text, name,
      (grouped.work_kind IS NOT DISTINCT FROM ($2::text[])[1]
        AND grouped.scope_id IS NOT DISTINCT FROM ($3::uuid[])[1]
        AND grouped.cutoff IS NOT DISTINCT FROM ($4::timestamptz[])[1]) AS "sameScope",
      division_id::text AS "divisionId", division_name AS "divisionName"
    FROM grouped CROSS JOIN LATERAL public.ceo_exact_work_labels(
      grouped.titles, grouped.work_kind, grouped.scope_id, grouped.cutoff) AS matched
    ${activeOnly && !request.asOf ? `WHERE EXISTS (SELECT FROM public.divisions AS division
      WHERE division.id = matched.division_id AND division.status = 'active')` : ''}`, [
    probes.map(({ title }) => title), probes.map(({ kind }) => kind ?? null), probes.map(({ divisionId }) => divisionId ?? null),
    probes.map(({ cutoff }) => cutoff ?? null), probes.map(({ primary }) => primary),
  ]);
  if (!rows.some(({ primary }) => primary)) return { candidates: [], complete: true, alternateMatch: rows.length > 0 };
  if (rows.some(({ sameScope }) => !sameScope)) return { candidates: [], complete: false };
  const candidates = new Map<string, PresentedChoice>();
  for (const { kind, id, name, divisionId, divisionName } of rows) {
    candidates.set(`${kind}/${id}`, { kind, id, name, divisionId, divisionName });
  }
  return { candidates: [...candidates.values()].sort((left, right) => left.name.localeCompare(right.name, 'id')
    || (left.divisionName ?? '').localeCompare(right.divisionName ?? '', 'id') || left.id.localeCompare(right.id)), complete: true };
}

export async function searchExact(db: RetrievalDatabase, request: CeoRequest, utterance?: Utterance) {
  const exact = await searchExactSpans(db, request, utterance);
  if (!utterance || !exact.complete || !request.subject) return exact;
  const label = workTitleMarker(request.subject);
  if (!label) return exact;
  const { kind } = label;
  if (!kind || kind === 'ambiguous' || request.entityKind !== kind) return exact;
  if (exact.candidates.length) {
    return exact.candidates.some((candidate) => candidate.kind !== kind) ? { candidates: [], complete: false } : exact;
  }
  // Some interpretations include the spoken type marker in the subject. A
  // second full-span proof still checks whether the wrapped label is a rival.
  const unwrapped = await searchExactSpans(db, { ...request, subject: label.subject }, utterance);
  return { ...unwrapped, alternateMatch: exact.alternateMatch || unwrapped.alternateMatch };
}

export { searchLexical };

function settleBeforeDeadline<T>(work: Promise<T>, signal: AbortSignal) {
  return new Promise<T | undefined>((resolve, reject) => {
    const abort = () => resolve(undefined);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    void work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

type SemanticResult = { candidates: Candidate[]; lexical?: Candidate[]; outcome: 'observed' | 'timeout' | 'error' | 'discarded' };

export async function searchSemantic(db: RetrievalDatabase, request: CeoRequest, embed: EmbedText,
  deadlineMs: number, signal?: AbortSignal, queryText?: string): Promise<SemanticResult> {
  if (!request.subject || signal?.aborted) return { candidates: [], outcome: 'discarded' };
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) return { candidates: [], outcome: 'timeout' };
  const timer = AbortSignal.timeout(Math.min(deadlineMs, 2500));
  const bounded = signal ? AbortSignal.any([signal, timer]) : timer;
  async function readCandidates(snapshot: RetrievalDatabase, { model, vector }: Awaited<ReturnType<EmbedText>>) {
    bounded.throwIfAborted();
    const { rows } = await snapshot.query<SearchRow>(`
      SELECT embedding.kind, embedding.resource_id::text AS id, coalesce(project.name, task.title) AS name,
        embedding.division_id::text AS "divisionId", division.name AS "divisionName",
        (1 - (embedding.embedding <=> $1::vector))::float8 AS score
      FROM public.work_search_embeddings AS embedding
      JOIN public.divisions AS division ON division.id = embedding.division_id AND division.status = 'active'
      LEFT JOIN public.projects AS project ON embedding.kind = 'project' AND project.id = embedding.resource_id AND project.division_id = division.id
      LEFT JOIN public.tasks AS task ON embedding.kind = 'task' AND task.id = embedding.resource_id AND task.division_id = division.id
      WHERE embedding.embedding IS NOT NULL AND embedding.model = $2
        AND ($3::uuid IS NULL OR embedding.division_id = $3)
        AND ($4::text IS NULL OR embedding.kind = $4)
        AND coalesce(project.name, task.title) IS NOT NULL
      ORDER BY embedding.embedding <=> $1::vector
      LIMIT 6`, [`[${vector.join(',')}]`, model, request.division?.id ?? null, request.entityKind ?? null]);
    return rows.filter(({ score }) => score >= 0.53).map((row) => ({ ...row, source: 'semantic' as const }));
  }
  const work = async (): Promise<SemanticResult> => {
    const query = queryText?.trim() || request.subject!;
    const result = await embed(query.slice(0, 2400), bounded);
    bounded.throwIfAborted();
    if (!result.model || result.vector.length !== 1536 || !result.vector.every(Number.isFinite)
      || !result.vector.some((value) => value !== 0)) throw new Error('Embedding pencarian tidak valid.');
    if (db.withSnapshot) {
      return db.withSnapshot(async (snapshot) => {
        const candidates = await readCandidates(snapshot, result);
        bounded.throwIfAborted();
        const lexical = await searchLexical(snapshot, request);
        return { candidates, lexical, outcome: 'observed' };
      });
    }
    return { candidates: await readCandidates(db, result), outcome: 'observed' };
  };
  try {
    const outcome = await settleBeforeDeadline(work(), bounded);
    if (outcome) return outcome;
  } catch {
    if (!bounded.aborted) return { candidates: [], outcome: 'error' };
  }
  const cancelled = signal?.aborted && !(signal.reason instanceof Error && signal.reason.name === 'TimeoutError');
  return { candidates: [], outcome: cancelled ? 'discarded' : 'timeout' };
}

export function candidateChoices(lexical: Candidate[], semantic: Candidate[]) {
  const unique = new Map<string, PresentedChoice>();
  const relevant = lexical.filter(({ score }) => score >= 0.4);
  const sorted = [...relevant.slice(0, 2), ...semantic.slice(0, 2), ...relevant.slice(2), ...semantic.slice(2)];
  for (const { kind, id, name, divisionId, divisionName } of sorted) {
    const key = `${kind}/${id}`;
    if (!unique.has(key)) unique.set(key, { kind, id, name, divisionId, divisionName });
  }
  return [...unique.values()].slice(0, 4);
}

export function choicesQuestion(choices: CeoEntity[]) {
  const labels = choices.map(choiceLabel);
  if (labels.length <= 2) return `Apakah yang Anda maksud ${labels.join(' atau ')}?`;
  const ordinals = ['pertama', 'kedua', 'ketiga', 'keempat'];
  return `Mana yang Anda maksud? ${labels.map((label, index) => `Pilihan ${ordinals[index]} adalah ${label}.`).join(' ')}`;
}

function choiceLabel({ name, kind, divisionName }: CeoEntity) {
  return `${kind === 'task' ? 'tugas' : 'proyek'} ${cleanLabel(name)}${divisionName ? ` dari divisi ${cleanLabel(divisionName)}` : ''}`;
}

export function distinctChoiceLabels(choices: CeoEntity[]) {
  return new Set(choices.map((choice) => titleText(choiceLabel(choice)))).size === choices.length;
}

export async function choiceStillMatches(db: RetrievalDatabase, request: CeoRequest, shown: PresentedChoice) {
  const checked = await searchExactSpans(db, request, undefined, true);
  const [live] = checked.candidates;
  return checked.complete && checked.candidates.length === 1 && live.id === shown.id && live.kind === shown.kind
    && live.name === shown.name && live.divisionId === shown.divisionId && live.divisionName === shown.divisionName;
}

export type { Candidate };
