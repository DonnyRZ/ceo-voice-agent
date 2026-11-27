import { bindCeoInterpretation, withEntity } from './bind-interpretation.js';
import { spokenDay } from './calendar.js';
import { candidateChoices, choiceStillMatches, choicesQuestion, distinctChoiceLabels, searchExact, searchLexical, searchSemantic, type Candidate, type EmbedText } from './candidates.js';
import { readDivisions } from './division-scope.js';
import { readFacts } from './facts.js';
import { interpretRequest, timePhase, type InterpretRequestInput } from './interpret-request.js';
import { titleText } from './label-evidence.js';
import type { CeoRequest, CeoRetrievalContext, PresentedChoice } from './request-types.js';
import { ceoEntity, type CeoFacts, type RetrievalDatabase } from './schema.js';
import { cleanLabel, spokenFacts } from './speech.js';

export type { CeoRetrievalContext } from './request-types.js';
export type { CeoFacts, RetrievalDatabase } from './schema.js';
export type { EmbedText } from './candidates.js';

export interface CeoRetrievalInput extends InterpretRequestInput {
  embed?: EmbedText;
  embeddingDeadlineMs?: number;
}

type TextOutcome = { kind: 'clarify' | 'no_match' | 'unsupported' | 'unavailable'; text: string; context: CeoRetrievalContext; facts?: undefined };
type FactsOutcome = { kind: 'facts'; text: string; context: CeoRetrievalContext; facts: CeoFacts };
export type CeoRetrievalOutcome = TextOutcome | FactsOutcome;
type Suggestions = { kind: 'suggestions'; request: CeoRequest; lexical: Candidate[] };

function clarification(prior: CeoRetrievalContext, request: CeoRequest, choices: PresentedChoice[], needsConfirmation = choices.length > 0): TextOutcome {
  const context = { request: prior.request, pendingRequest: request, needsConfirmation: needsConfirmation || undefined };
  if (!choices.length || !distinctChoiceLabels(choices)) {
    return { kind: 'clarify', text: 'Sebutkan nama resmi, divisi, atau pembeda lain yang tercatat di timesheet.',
      context };
  }
  return { kind: 'clarify', text: choicesQuestion(choices), context: { ...context, choices } };
}

function retainPending({ request, pendingRequest, needsConfirmation }: CeoRetrievalContext): CeoRetrievalContext {
  return { request, pendingRequest, needsConfirmation };
}

async function readBoundRequest(input: CeoRetrievalInput, interpretation: Awaited<ReturnType<typeof interpretRequest>>,
  refreshDirectory: boolean): Promise<CeoRetrievalOutcome | Suggestions> {
  input.signal?.throwIfAborted();
  const priorContext = input.context ?? {};
  const divisions = refreshDirectory ? await readDivisions(input.db) : interpretation.divisions;
  const parsed = bindCeoInterpretation(interpretation.value, { ...interpretation, divisions });
  if (parsed.kind !== 'request') {
    return { ...parsed, context: retainPending(priorContext) };
  }

  let request = parsed.request;
  if (parsed.pendingTemporal && (priorContext.needsConfirmation || priorContext.choices?.length)) {
    const choices = await timePhase(input, 'candidate_lookup', async () => {
      const shownChoices = priorContext.choices ?? [];
      for (const shown of shownChoices) {
        input.signal?.throwIfAborted();
        const division = divisions.find(({ id }) => id === shown.divisionId);
        if (!division || (request.division && request.division.id !== division.id)) return [];
        const scoped = withEntity({ ...request, division }, shown, division.id);
        if (!await choiceStillMatches(input.db, scoped, shown)) return [];
      }
      return shownChoices;
    });
    return clarification(priorContext, request, choices, true);
  }
  if (parsed.selection) {
    const shown = parsed.selection;
    const checked = await timePhase(input, 'candidate_lookup', () => choiceStillMatches(input.db, request, shown));
    if (!checked) {
      return clarification(priorContext, priorContext.pendingRequest ?? request, [], true);
    }
  } else if (request.subject && !request.entity) {
    const found = await timePhase(input, 'candidate_lookup', async () => {
      const utterance = interpretation.value.target === 'named_work'
        ? { transcript: interpretation.transcript, divisions, superseded: parsed.superseded } : undefined;
      const exact = await searchExact(input.db, request, utterance);
      input.signal?.throwIfAborted();
      if (!exact.complete || exact.candidates.length || (request.asOf && exact.alternateMatch)) return { exact };
      if (request.asOf && utterance) {
        const current = await searchExact(input.db, { ...request, asOf: undefined }, utterance);
        input.signal?.throwIfAborted();
        if (current.complete && current.candidates.length === 1) return { exact, current: current.candidates[0] };
      }
      if (parsed.superseded) return { exact };
      const lexical = await searchLexical(input.db, request);
      return { exact, lexical };
    });
    if (!found.exact.complete || found.exact.candidates.length > 1) {
      return clarification(priorContext, request, found.exact.candidates.slice(0, 4), true);
    }
    const [exact] = found.exact.candidates;
    if (!exact && request.asOf && found.exact.alternateMatch) return clarification(priorContext, request, []);
    if (!exact && request.asOf && found.current) {
      const kind = found.current.kind === 'project' ? 'proyek' : 'tugas';
      return { kind: 'clarify',
        text: `Saya belum menemukan catatan ${kind} ${cleanLabel(found.current.name)} per ${spokenDay(request.asOf)}. Apakah tanggal acuannya benar?`,
        context: { request: priorContext.request, pendingRequest: { ...request, subject: titleText(found.current.name) } } };
    }
    if (!exact && parsed.superseded) return clarification(priorContext, request, []);
    if (!exact) return { kind: 'suggestions', request, lexical: found.lexical ?? [] };
    if (interpretation.value.target === 'named_work' && request.entityKind && request.entityKind !== exact.kind) {
      return clarification(priorContext, request, [], true);
    }
    request = withEntity(request, ceoEntity.parse(exact), exact.divisionId);
  }

  if (request.intent !== 'summary' && !request.entity && !request.latest) {
    return clarification(priorContext, request, []);
  }
  const facts = await timePhase(input, 'facts_lookup', () => readFacts(input.db, request));
  input.signal?.throwIfAborted();
  if (!facts) {
    const text = request.asOf ? 'Belum ada catatan timesheet untuk tanggal acuan tersebut.'
      : request.intent === 'history' ? 'Belum ada riwayat status yang tercatat untuk pilihan tersebut.'
        : 'Belum ada catatan timesheet untuk pilihan tersebut.';
    return { kind: 'no_match', text, context: { request: priorContext.request, pendingRequest: request } };
  }
  const entityDivisionId = request.entityDivisionId ?? divisions.find(({ name }) => name === facts.entity?.divisionName)?.id;
  const context: CeoRetrievalContext = { request: facts.entity ? withEntity(request, facts.entity, entityDivisionId) : request };
  return { kind: 'facts', facts, text: spokenFacts(facts, request.summaryDetail), context };
}

export async function retrieveCeoAnswer(input: CeoRetrievalInput): Promise<CeoRetrievalOutcome> {
  const interpretation = await interpretRequest(input);
  const bound = bindCeoInterpretation(interpretation.value, interpretation);
  const prior = input.context ?? {};
  if (bound.kind !== 'request') return { ...bound, context: retainPending(prior) };
  const result = input.db.withSnapshot
    ? await input.db.withSnapshot((db) => readBoundRequest({ ...input, db }, interpretation, true))
    : await readBoundRequest(input, interpretation, false);
  input.signal?.throwIfAborted();
  if (result.kind !== 'suggestions') return result;

  const { request, lexical } = result;
  const semanticStarted = performance.now();
  const semanticQuery = interpretation.value.target === 'named_work' ? interpretation.transcript : request.subject;
  const semantic = input.embed && !request.asOf && !lexical.some(({ score }) => score >= 0.75)
    ? await searchSemantic(input.db, request, input.embed, input.embeddingDeadlineMs ?? 2000, input.signal, semanticQuery) : undefined;
  if (semantic) input.observePhase?.({ type: 'latency', stage: 'semantic_lookup',
    outcome: semantic.outcome, durationMs: performance.now() - semanticStarted });
  input.signal?.throwIfAborted();
  const currentLexical = semantic?.lexical ?? (semantic && lexical.length && input.db.withSnapshot
    ? await input.db.withSnapshot((db) => searchLexical(db, request)) : lexical);
  input.signal?.throwIfAborted();
  const choices = candidateChoices(currentLexical, semantic?.candidates ?? []);
  if (choices.length) return clarification(prior, request, choices);
  if (semantic && semantic.outcome !== 'observed') {
    return { kind: 'unavailable', text: 'Pencarian belum selesai. Coba lagi atau sebutkan nama resminya.',
      context: { request: prior.request, pendingRequest: request } };
  }
  return { kind: 'no_match', text: 'Saya belum menemukan pilihan yang cocok di timesheet. Bisa sebutkan nama resmi atau divisinya?',
    context: { request: prior.request, pendingRequest: request } };
}
