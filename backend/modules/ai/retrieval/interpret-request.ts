import type { VoiceTranscriptMessage } from '../voice/transcript.js';
import type { VoiceRetrievalPhaseMetric } from '../voice/types.js';
import { untilAborted } from '../voice/lifecycle.js';
import { bindCeoInterpretation } from './bind-interpretation.js';
import { jakartaDate } from './calendar.js';
import { readLiteralTitleHints, searchExact } from './candidates.js';
import { readDivisions } from './division-scope.js';
import { ceoInterpretation, type CeoInterpretation, type IntentResponseMetadata, type InterpretCeoTurn } from './interpretation.js';
import { titleText, withoutDivisionOverlap, workTitleMarker } from './label-evidence.js';
import type { CeoRetrievalContext } from './request-types.js';
import type { RetrievalDatabase } from './schema.js';

export interface InterpretRequestInput {
  db: RetrievalDatabase;
  transcript: string;
  history?: readonly VoiceTranscriptMessage[];
  interpret: InterpretCeoTurn;
  context?: CeoRetrievalContext;
  now?: Date;
  signal?: AbortSignal;
  observePhase?(metric: VoiceRetrievalPhaseMetric): void;
}

export async function timePhase<T>(
  { signal, observePhase }: Pick<InterpretRequestInput, 'signal' | 'observePhase'>,
  stage: VoiceRetrievalPhaseMetric['stage'],
  run: (observeProvider: (details: IntentResponseMetadata) => void) => Promise<T>,
) {
  if (!observePhase) return run(() => {});
  const start = performance.now();
  let provider: IntentResponseMetadata | undefined;
  let reported = false;
  const report = (outcome: VoiceRetrievalPhaseMetric['outcome']) => {
    if (reported) return;
    reported = true;
    observePhase({ type: 'latency', stage, outcome, durationMs: performance.now() - start, provider });
  };
  const aborted = () => report(signal?.reason instanceof Error && signal.reason.name === 'TimeoutError' ? 'timeout' : 'discarded');
  signal?.addEventListener('abort', aborted, { once: true });
  try {
    signal?.throwIfAborted();
    const result = await run((details) => { provider = details; });
    signal?.throwIfAborted();
    report('observed');
    return result;
  } catch (error) {
    if (signal?.aborted) aborted();
    else report(error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'error');
    throw error;
  } finally {
    signal?.removeEventListener('abort', aborted);
  }
}

async function recheckScopedTitle(input: InterpretRequestInput, value: CeoInterpretation,
  evidence: Omit<Parameters<InterpretCeoTurn>[0], 'signal' | 'observe' | 'scopeRecheck'>) {
  const original = value.subject;
  if (value.kind !== 'lookup' || value.target !== 'named_work' || !original || !value.divisionId
      || value.correction || value.asOf || value.from || value.to || value.operation === 'history') return value;
  const bound = bindCeoInterpretation(value, evidence);
  if (bound.kind !== 'request' || !bound.request.division || bound.request.subject !== titleText(original)) return value;

  const { transcript, divisions, currentTitleHints = [] } = evidence;
  const subject = bound.request.subject;
  const unwrapped = workTitleMarker(subject)?.subject ?? subject;
  const hints = [...new Map(currentTitleHints.map((title) => [titleText(title), title])).entries()];
  const prefixes = hints.filter(([title]) => subject.startsWith(`${title} `) || unwrapped.startsWith(`${title} `));
  if (prefixes.length !== 1) return value;
  const [[candidate, registeredTitle]] = prefixes;
  if (hints.some(([title]) => title !== candidate && [title, workTitleMarker(title)?.subject].some((label) =>
    label === candidate || label?.startsWith(`${candidate} `)))) return value;

  try {
    const prospective = bindCeoInterpretation({ ...value, subject: registeredTitle }, evidence);
    if (prospective.kind !== 'request' || prospective.request.subject !== candidate) return value;
    const checked = await searchExact(input.db, prospective.request, { transcript, divisions });
    input.signal?.throwIfAborted();
    if (!checked.complete || checked.candidates.length !== 1 || titleText(checked.candidates[0].name) !== candidate) return value;
    const timeout = AbortSignal.timeout(2_800);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    const revised = ceoInterpretation.parse(await timePhase({ ...input, signal }, 'scope_recheck', (observe) => untilAborted(
      input.interpret({ ...evidence, scopeRecheck: { provisional: value, registeredTitle }, signal, observe }), signal,
    )));
    if (!revised.subject || !revised.divisionExcerpt || titleText(revised.subject) !== candidate
        || JSON.stringify({ ...revised, subject: value.subject, divisionExcerpt: value.divisionExcerpt }) !== JSON.stringify(value)) return value;
    const proven = titleText(withoutDivisionOverlap(transcript, original, revised.divisionExcerpt, bound.request.division));
    if (proven === candidate || workTitleMarker(proven)?.subject === candidate) {
      return { ...value, divisionExcerpt: revised.divisionExcerpt };
    }
  } catch {
    input.signal?.throwIfAborted();
  }
  return value;
}

export async function interpretRequest(input: InterpretRequestInput) {
  const transcript = input.transcript.trim().slice(0, 2400);
  const context = input.context;
  input.signal?.throwIfAborted();
  const [divisions, currentTitleHints] = await Promise.all([
    timePhase(input, 'division_lookup', () => readDivisions(input.db)),
    readLiteralTitleHints(input.db, transcript).catch(() => []),
  ]);
  input.signal?.throwIfAborted();
  const today = jakartaDate(input.now ?? new Date());
  const evidence = { transcript, context, divisions, currentTitleHints, today, history: input.history ?? [] };
  const interpreted = await timePhase(input, 'intent_inference', (observe) =>
    input.interpret({ ...evidence, signal: input.signal, observe }));
  input.signal?.throwIfAborted();
  const value = await recheckScopedTitle(input, ceoInterpretation.parse(interpreted), evidence);
  input.signal?.throwIfAborted();
  return { value, transcript, context, divisions, today };
}
