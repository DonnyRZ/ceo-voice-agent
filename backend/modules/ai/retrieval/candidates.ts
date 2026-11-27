import type { CeoRequest, WorkKind } from './request-types.js';
import type { CeoEntity, RetrievalDatabase } from './schema.js';
import { cleanLabel } from './speech.js';
import { normalized, phraseIndex, readNumber, wordsOf } from './words.js';

type Candidate = CeoEntity & { divisionId: string; score: number; source: 'exact' | 'lexical' | 'semantic' };
type SearchRow = Omit<Candidate, 'source'>;
export type EmbedText = (text: string, signal: AbortSignal) => Promise<{ model: string; vector: number[] }>;

export async function searchLexical(db: RetrievalDatabase, request: CeoRequest, exact: boolean): Promise<Candidate[]> {
  if (!request.subject) return [];
  const kinds: WorkKind[] = request.entityKind ? [request.entityKind] : ['project', 'task'];
  const results = await Promise.all(kinds.map((kind) => db.query<SearchRow>(`
    SELECT $1::text AS kind, matched.id, matched.name, matched.division_id::text AS "divisionId",
      division.name AS "divisionName", matched.score
    FROM public.ceo_search_work($1::text, $2::text, $3::uuid, $4::timestamptz, $5::boolean) AS matched
    JOIN public.divisions AS division ON division.id = matched.division_id`,
  [kind, request.subject, request.division?.id ?? null, request.asOf ?? null, exact])));
  const source = exact ? 'exact' as const : 'lexical' as const;
  return results.flatMap(({ rows }) => rows.map((row) => ({ ...row, source })))
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, 'id') || left.id.localeCompare(right.id));
}

function settleBeforeDeadline<T>(work: Promise<T>, signal: AbortSignal) {
  return new Promise<T | undefined>((resolve, reject) => {
    const abort = () => resolve(undefined);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    void work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function searchSemantic(db: RetrievalDatabase, request: CeoRequest, embed: EmbedText,
  deadlineMs: number, signal?: AbortSignal): Promise<Candidate[]> {
  if (!request.subject || signal?.aborted || !Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) return [];
  const timer = AbortSignal.timeout(Math.min(deadlineMs, 1000));
  const bounded = signal ? AbortSignal.any([signal, timer]) : timer;
  const work = async () => {
    const result = await embed(request.subject!.slice(0, 250), bounded);
    if (bounded.aborted || !result.model || result.vector.length !== 1536 || !result.vector.every(Number.isFinite)
      || !result.vector.some((value) => value !== 0)) return [];
    const { rows } = await db.query<SearchRow>(`
      SELECT embedding.kind, embedding.resource_id::text AS id, coalesce(project.name, task.title) AS name,
        embedding.division_id::text AS "divisionId", division.name AS "divisionName",
        (1 - (embedding.embedding <=> $1::vector))::float8 AS score
      FROM public.work_search_embeddings AS embedding
      JOIN public.divisions AS division ON division.id = embedding.division_id
      LEFT JOIN public.projects AS project ON embedding.kind = 'project' AND project.id = embedding.resource_id AND project.division_id = division.id
      LEFT JOIN public.tasks AS task ON embedding.kind = 'task' AND task.id = embedding.resource_id AND task.division_id = division.id
      WHERE embedding.embedding IS NOT NULL AND embedding.model = $2
        AND ($3::uuid IS NULL OR embedding.division_id = $3)
        AND ($4::text IS NULL OR embedding.kind = $4)
        AND coalesce(project.name, task.title) IS NOT NULL
      ORDER BY embedding.embedding <=> $1::vector
      LIMIT 6`, [`[${result.vector.join(',')}]`, result.model, request.division?.id ?? null, request.entityKind ?? null]);
    return rows.filter(({ score }) => score >= 0.53).map((row) => ({ ...row, source: 'semantic' as const }));
  };
  try {
    return await settleBeforeDeadline(work(), bounded) ?? [];
  } catch {
    return [];
  }
}

export function exactCandidates(lexical: Candidate[], subject: string) {
  return lexical.filter(({ name, source }) => source === 'exact' && normalized(name) === subject);
}

export function candidateChoices(lexical: Candidate[], semantic: Candidate[]) {
  const unique = new Map<string, CeoEntity>();
  const sorted = [...lexical.filter(({ score }) => score >= 0.4), ...semantic];
  for (const { kind, id, name, divisionName } of sorted) {
    const key = `${kind}/${id}`;
    if (!unique.has(key)) unique.set(key, { kind, id, name, divisionName });
  }
  return [...unique.values()].slice(0, 4);
}

export function confirmCandidate(transcript: string, choices: CeoEntity[]) {
  const words = wordsOf(transcript);
  if (words.some((word) => ['bukan', 'tidak', 'jangan'].includes(word))) return;
  if (choices.length === 1 && ['ya', 'iya', 'betul', 'benar', 'itu', 'ya betul', 'yang itu'].includes(words.join(' '))) return choices[0];
  const numberMarker = words.findIndex((word) => ['nomor', 'pilihan', 'ke'].includes(word));
  const marker = numberMarker >= 0 ? numberMarker : words.indexOf('yang');
  const index = marker >= 0 ? marker + 1 : 0;
  const number = readNumber(words, index);
  const ordinal = words[index] === 'pertama' ? 1 : words[index] === 'kedua' ? 2 : words[index] === 'ketiga' ? 3 : words[index] === 'keempat' ? 4 : number?.value;
  const simpleChoice = words.slice(0, index).every((word) => ['yang', 'nomor', 'pilihan', 'ke', 'ya', 'iya', 'betul'].includes(word))
    && words.slice(index + (number?.length ?? 1)).every((word) => ['ya', 'betul'].includes(word));
  if (ordinal && ordinal <= choices.length && simpleChoice && (marker >= 0 || words.length === 1)) return choices[ordinal - 1];
  const subject = words.filter((word) => !['yang', 'maksud', 'saya', 'itu', 'proyek', 'tugas'].includes(word));
  if (!subject.length) return;
  const matched = choices.filter(({ name, divisionName }) => phraseIndex(wordsOf(name), subject) >= 0 || phraseIndex(wordsOf(divisionName ?? ''), subject) >= 0);
  if (matched.length === 1) return matched[0];
}

export function choicesQuestion(choices: CeoEntity[]) {
  const labels = choices.map(({ name, kind, divisionName }, index) => {
    const entity = `${kind === 'task' ? 'tugas' : 'proyek'} ${cleanLabel(name)}${divisionName ? ` dari divisi ${cleanLabel(divisionName)}` : ''}`;
    return choices.length > 1 ? `${index + 1}. ${entity}` : entity;
  });
  return labels.length === 1 ? `Apakah yang Anda maksud ${labels[0]}?` : `Mana yang Anda maksud? ${labels.join('. ')}.`;
}

export type { Candidate };
