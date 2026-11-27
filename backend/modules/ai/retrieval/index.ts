import { candidateChoices, choicesQuestion, confirmCandidate, exactCandidates, searchLexical, searchSemantic, type Candidate, type EmbedText } from './candidates.js';
import { readDivisions } from './division-scope.js';
import { readFacts } from './facts.js';
import { parseCeoIntent, type IntentResult } from './intent.js';
import type { CeoRequest, CeoRetrievalContext } from './request-types.js';
import { ceoEntity, type CeoEntity, type CeoFacts, type RetrievalDatabase } from './schema.js';
import { spokenFacts } from './speech.js';
import { normalized } from './words.js';

export type { CeoRetrievalContext } from './request-types.js';
export type { CeoFacts, RetrievalDatabase } from './schema.js';
export type { EmbedText } from './candidates.js';

export interface CeoRetrievalInput {
  db: RetrievalDatabase;
  transcript: string;
  context?: CeoRetrievalContext;
  now?: Date;
  embed?: EmbedText;
  embeddingDeadlineMs?: number;
  signal?: AbortSignal;
  prepared?: CeoCandidatePreparation;
}

export interface CeoCandidatePreparation {
  transcript: string;
  context?: CeoRetrievalContext;
  preparedAt: number;
  parsed: IntentResult;
  lexical: Candidate[];
}

type TextOutcome = { kind: 'clarify' | 'no_match' | 'unsupported'; text: string; context: CeoRetrievalContext; facts?: undefined };
type FactsOutcome = { kind: 'facts'; text: string; context: CeoRetrievalContext; facts: CeoFacts };
export type CeoRetrievalOutcome = TextOutcome | FactsOutcome;

function withEntity(request: CeoRequest, entity: CeoEntity) {
  return { ...request, entity, subject: normalized(entity.name), entityKind: entity.kind === 'division' ? undefined : entity.kind };
}

export async function prepareCeoCandidates(input: CeoRetrievalInput): Promise<CeoCandidatePreparation> {
  const transcript = input.transcript.trim().slice(0, 2400);
  const context = input.context;
  const preparedAt = Date.now();
  input.signal?.throwIfAborted();
  const confirmed = context?.choices && confirmCandidate(transcript, context.choices);
  if (confirmed && context?.request) {
    return { transcript, context, preparedAt, parsed: { kind: 'request', request: withEntity(context.request, confirmed) }, lexical: [] };
  }
  const divisions = await readDivisions(input.db);
  input.signal?.throwIfAborted();
  const parsed = parseCeoIntent(transcript, divisions, input.now ?? new Date(), context);
  const lexical = parsed.kind === 'request' && parsed.request.subject && !parsed.request.entity
    ? await searchLexical(input.db, parsed.request, true) : [];
  input.signal?.throwIfAborted();
  return { transcript, context, preparedAt, parsed, lexical };
}

function preparedForInput(input: CeoRetrievalInput) {
  const prepared = input.prepared;
  if (prepared?.transcript === input.transcript.trim().slice(0, 2400) && prepared.context === input.context
    && Date.now() - prepared.preparedAt <= 1500) return prepared;
}

export async function retrieveCeoAnswer(input: CeoRetrievalInput): Promise<CeoRetrievalOutcome> {
  input.signal?.throwIfAborted();
  const priorContext = input.context ?? {};
  const { parsed, lexical } = preparedForInput(input) ?? await prepareCeoCandidates(input);
  if (parsed.kind !== 'request') {
    if (parsed.kind === 'unsupported' && priorContext.choices?.length && ['tidak', 'bukan itu', 'yang lain'].includes(normalized(input.transcript))) {
      return { kind: 'clarify', text: 'Apa nama proyek atau tugas yang Anda maksud? Sebutkan divisinya jika perlu.', context: { request: priorContext.request } };
    }
    return { ...parsed, context: priorContext };
  }

  let request = parsed.request;
  if (request.subject && !request.entity) {
    const exact = exactCandidates(lexical, request.subject);
    if (exact.length === 1) {
      request = withEntity(request, ceoEntity.parse(exact[0]));
    } else {
      const near = exact.length ? [] : await searchLexical(input.db, request, false);
      input.signal?.throwIfAborted();
      const semantic = input.embed && !request.asOf && !exact.length && !near.some(({ score }) => score >= 0.75)
        ? await searchSemantic(input.db, request, input.embed, input.embeddingDeadlineMs ?? 300, input.signal) : [];
      input.signal?.throwIfAborted();
      const choices = exact.length ? exact.slice(0, 4).map((candidate) => ceoEntity.parse(candidate)) : candidateChoices(near, semantic);
      if (choices.length) return { kind: 'clarify', text: choicesQuestion(choices), context: { request, choices } };
      return { kind: 'no_match', text: 'Saya belum menemukan proyek atau tugas yang cocok di timesheet. Bisa sebutkan nama resmi atau divisinya?', context: { request } };
    }
  }

  if (request.intent !== 'summary' && !request.entity && !(request.latest && request.entityKind && request.intent === 'status')) {
    return { kind: 'clarify', text: 'Proyek atau tugas mana yang ingin Anda lihat?', context: { request } };
  }
  const facts = await readFacts(input.db, request);
  input.signal?.throwIfAborted();
  if (!facts) {
    const text = request.asOf ? 'Belum ada catatan timesheet untuk tanggal acuan tersebut.'
      : request.intent === 'history' ? 'Belum ada riwayat status yang tercatat untuk pilihan tersebut.'
        : 'Belum ada catatan timesheet untuk pilihan tersebut.';
    return { kind: 'no_match', text, context: { request } };
  }
  const context: CeoRetrievalContext = { request: facts.entity ? withEntity(request, facts.entity) : request };
  return { kind: 'facts', facts, text: spokenFacts(facts), context };
}
