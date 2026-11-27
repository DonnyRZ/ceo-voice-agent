import { endOfJakartaDay } from './calendar.js';
import type { CeoInterpretation } from './interpretation.js';
import { divisionsIn } from './division-scope.js';
import { literalSpans, supersededTitle, titleText, titleTypeMarker, withoutDivisionOverlap, withoutSubject, workKindIn, type TitleSpan } from './label-evidence.js';
import type { CeoRequest, CeoRetrievalContext, DivisionRef, PresentedChoice } from './request-types.js';
import type { CeoEntity } from './schema.js';

type Clarification = NonNullable<CeoInterpretation['clarify']>;
type Binding =
  | { kind: 'request'; request: CeoRequest; selection?: PresentedChoice; superseded?: TitleSpan; pendingTemporal?: boolean }
  | { kind: 'clarify' | 'unsupported'; text: string };

const questions: Record<Clarification, string> = {
  project_or_task: 'Proyek atau tugas mana yang ingin Anda lihat?',
  division: 'Divisi mana yang ingin Anda lihat?',
  period: 'Tanggal atau periode mana yang ingin Anda lihat?',
  operation: 'Informasi timesheet apa yang ingin Anda lihat?',
};

const clarify = (reason: Clarification = 'project_or_task'): Binding => ({ kind: 'clarify', text: questions[reason] });

export function withEntity(request: CeoRequest, entity: CeoEntity, entityDivisionId = request.entityDivisionId): CeoRequest {
  return { ...request, entity, entityDivisionId, subject: titleText(entity.name),
    entityKind: entity.kind === 'division' ? undefined : entity.kind };
}

function spokenSelection(transcript: string, choices: PresentedChoice[]) {
  const statement = titleText(transcript).replace(/[.!?]+$/u, '').trim();
  const ordinal = /^(?:nomor |pilihan |yang )?(?:ke-?)?([1-4]|pertama|kedua|ketiga|keempat|satu|dua|tiga|empat)$/u.exec(statement)?.[1];
  if (ordinal) {
    const words = ['pertama', 'kedua', 'ketiga', 'keempat'];
    const numbers = ['satu', 'dua', 'tiga', 'empat'];
    return choices[Number(ordinal) - 1] ?? choices[words.indexOf(ordinal)] ?? choices[numbers.indexOf(ordinal)];
  }
  if (choices.length === 1 && /^(?:ya|iya|betul|benar|yang itu)$/u.test(statement)) return choices[0];
  const descriptor = statement.replace(/^yang /u, '').replace(/^(?:(?:di|dari) (?:divisi )?|divisi )/u, '');
  const matches = choices.filter(({ name, divisionName }) =>
    descriptor === titleText(name) || descriptor.replace(/^(?:proyek|tugas) /u, '') === titleText(name)
    || (divisionName && (descriptor === titleText(divisionName)
      || descriptor === titleText(`${name} dari divisi ${divisionName}`))));
  if (matches.length === 1) return matches[0];
}

function bindSelection(context: CeoRetrievalContext | undefined, id: string | null,
  divisions: DivisionRef[], transcript: string): Binding {
  const request = context?.pendingRequest;
  const entity = context?.choices && spokenSelection(transcript, context.choices);
  if (!request || !entity || entity.id !== id) return clarify();
  const division = divisions.find(({ id }) => id === entity.divisionId);
  if (!division || division.name !== entity.divisionName
      || (request.division && request.division.id !== division.id)) return clarify('division');
  return { kind: 'request', request: withEntity({ ...request, division }, entity, division.id), selection: entity };
}

function isPendingTemporalChange(value: CeoInterpretation, pending: CeoRequest | undefined, operation: string) {
  if (!pending?.subject || pending.entity || value.divisionId || value.divisionExcerpt || value.statuses.length
    || (value.summaryDetail && value.summaryDetail !== pending.summaryDetail)
    || (value.workKind && value.workKind !== pending.entityKind)) return false;
  const sameOperation = operation === (pending.focusUpdatedAt ? 'updated_at' : pending.intent);
  const sameSubject = value.subject === null || titleText(value.subject) === pending.subject;
  const temporalClear = value.clear?.every((field) => field === 'period' || field === 'asOf') ?? true;
  return sameOperation && sameSubject && temporalClear && Boolean(value.from || value.to || value.asOf || value.clear?.length);
}

export function bindCeoInterpretation(value: CeoInterpretation, input: {
  transcript: string; divisions: DivisionRef[]; today: string; context?: CeoRetrievalContext;
}): Binding {
  const { transcript, divisions, today, context } = input;
  if (value.kind === 'unsupported') {
    return { kind: 'unsupported', text: 'Saya bisa membacakan status, PIC, riwayat, atau rekap yang tercatat di timesheet.' };
  }
  if (value.kind === 'clarify') return clarify(value.clarify ?? 'operation');
  if (value.kind === 'select_candidate') {
    if (value.operation || value.target || value.subject || value.divisionId || value.workKind ||
        value.from || value.to || value.asOf || value.statuses.length || value.clarify || value.clear?.length
        || value.correction || value.divisionExcerpt) return clarify('operation');
    return bindSelection(context, value.selectionId, divisions, transcript);
  }
  if (!value.target || value.selectionId || value.clarify) return clarify('operation');

  const { from, to, asOf, target } = value;
  if (value.correction && target !== 'named_work') return clarify();
  const division = divisions.find(({ id }) => id === value.divisionId);
  const boundedSubject = target === 'named_work' && value.subject && division && value.divisionExcerpt
    ? withoutDivisionOverlap(transcript, value.subject, value.divisionExcerpt, division) : value.subject;
  const superseded = value.correction && boundedSubject
    ? supersededTitle(transcript, boundedSubject, value.correction) : undefined;
  const previous = target === 'previous_work' ? (context?.pendingRequest ?? context?.request) : undefined;
  const previousEntity = previous?.entity;
  const confirmed = context?.request?.entity;
  const confirmedWork = previousEntity && confirmed && confirmed.kind !== 'division'
    && previousEntity.id === confirmed.id && previousEntity.kind === confirmed.kind
    && titleText(previousEntity.name) === titleText(confirmed.name) ? confirmed : undefined;
  const operation = value.operation ?? (previous?.focusUpdatedAt ? 'updated_at' : previous?.intent);
  if (!operation) return clarify('operation');
  const clear = new Set(value.clear);
  if (clear.size && target !== 'previous_work') return clarify('operation');
  if ((clear.has('division') && value.divisionId) || (clear.has('period') && (from || to))
      || (clear.has('asOf') && asOf) || (clear.has('statuses') && value.statuses.length)) return clarify('operation');
  if ((from && to && from > to) || (asOf && asOf > today)) return clarify('period');
  const outside = withoutSubject(withoutSubject(transcript, superseded?.text ?? null), boundedSubject);
  const mentioned = divisionsIn(outside, divisions);
  const previousKindEvidence = target === 'previous_work' ? workKindIn(outside) : undefined;
  const echoedDivision = division && confirmedWork && !mentioned.length
    && division.id === previous?.entityDivisionId && division.id === context?.request?.entityDivisionId
    && division.name === confirmedWork.divisionName && (!previousKindEvidence || previousKindEvidence === confirmedWork.kind)
    && (!value.workKind || value.workKind === confirmedWork.kind);
  if ((value.divisionId && (!division || (!echoedDivision && !mentioned.some(({ id }) => id === division.id))))
      || mentioned.length > 1 || (!value.divisionId && mentioned.length)) return clarify('division');
  if (value.statuses.length && operation !== 'summary') return clarify('operation');

  const request: CeoRequest = {
    intent: operation === 'updated_at' ? 'status' : operation,
    entityKind: value.workKind ?? undefined,
    division,
    period: from || to ? { from: from ?? undefined, to: to ?? undefined } : undefined,
    asOf: asOf ? endOfJakartaDay(asOf) : undefined,
    statuses: value.statuses.length ? [...new Set(value.statuses)] : undefined,
    summaryDetail: operation === 'summary' ? value.summaryDetail ?? previous?.summaryDetail : undefined,
    focusUpdatedAt: operation === 'updated_at' || undefined,
    latest: target === 'latest_work',
  };
  switch (target) {
    case 'named_work': {
      const subject = boundedSubject && titleText(boundedSubject);
      const utterance = titleText(transcript);
      const spans = subject ? literalSpans(utterance, subject) : [];
      if (!subject || !spans.length) return clarify();
      request.subject = subject;
      const literalKind = spans.length === 1 ? titleTypeMarker(utterance, spans[0]) : undefined;
      if (operation !== 'summary' && literalKind && request.entityKind && literalKind !== request.entityKind) return clarify();
      break;
    }
    case 'previous_work': {
      if (!previous) return clarify();
      const pendingTemporal = previous === context?.pendingRequest && isPendingTemporalChange(value, previous, operation);
      if (pendingTemporal && previousKindEvidence && previousKindEvidence !== previous.entityKind) return clarify();
      if (value.subject !== null) {
        const echo = titleText(value.subject);
        if (!pendingTemporal && (!confirmedWork || echo !== titleText(confirmedWork.name)
            || (previousKindEvidence && previousKindEvidence !== confirmedWork.kind))) return clarify();
      }
      if (!clear.has('division')) request.division ??= previous.division;
      if (!clear.has('period')) request.period ??= previous.period;
      if (!clear.has('asOf')) request.asOf ??= previous.asOf;
      if (operation === 'summary' && !clear.has('statuses')) request.statuses ??= previous.statuses;
      if (request.division && !divisions.some(({ id, name, code }) =>
        id === request.division?.id && name === request.division.name && code === request.division.code)) return clarify('division');
      if (operation === 'summary' && previous.intent === 'summary'
          && (previous.entity?.kind === 'division' || (!previous.entity && !previous.subject))) {
        break;
      }
      if (!previousEntity) {
        if (!previous.subject || (!division && !from && !to && !asOf && !clear.size)) return clarify();
        if (previous === context?.pendingRequest && (context.needsConfirmation || context.choices?.length)
            && !pendingTemporal && (!division || division.id === previous.division?.id)) return clarify();
        return { kind: 'request', pendingTemporal, request: { ...request, entityKind: previous.entityKind, subject: previous.subject } };
      }
      if (previousEntity.kind === 'division') return clarify();
      if (value.workKind && value.workKind !== previousEntity.kind) return clarify();
      const previousDivision = divisions.find(({ id }) => id === previous.entityDivisionId) ?? previous.division;
      if (division && division.id !== previousDivision?.id) {
        return { kind: 'request', request: {
          ...request, entityKind: previousEntity.kind, subject: titleText(previousEntity.name),
        } };
      }
      const scope = request.division ?? previousDivision;
      if (!scope) return clarify('division');
      return { kind: 'request', request: withEntity({ ...request, division: scope }, previousEntity, scope.id) };
    }
    case 'latest_work':
      if (!request.entityKind || request.intent === 'summary' || operation === 'history' || value.subject
          || (request.entityKind === 'project' && request.period)) return clarify();
      break;
    case 'division_or_company':
      if (operation !== 'summary' || value.subject || request.entityKind === 'project') return clarify();
      break;
  }
  return { kind: 'request', request, superseded };
}
