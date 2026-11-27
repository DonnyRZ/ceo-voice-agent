import type { WorkStatus } from '../../work-status.js';
import { spokenDay, spokenTime } from './calendar.js';
import type { SummaryDetail } from './request-types.js';
import type { CeoEntity, CeoFacts, CeoPeriod, CountFact } from './schema.js';

const statuses: Record<WorkStatus, string> = { pending: 'pending', on_progress: 'sedang dikerjakan', done: 'selesai' };

export function cleanLabel(text: string) {
  return text.replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ').trim().slice(0, 160);
}

function target(entity?: CeoEntity) {
  if (!entity) return 'timesheet perusahaan';
  const kind = entity.kind === 'project' ? 'proyek' : entity.kind === 'task' ? 'tugas' : 'divisi';
  const division = entity.divisionName && entity.kind !== 'division' ? ` di divisi ${cleanLabel(entity.divisionName)}` : '';
  return `${kind} ${cleanLabel(entity.name)}${division}`;
}

function periodText(period?: CeoPeriod) {
  if (period?.from && period.to && period.from === period.to) return ` pada ${spokenDay(period.from)}`;
  if (period?.from && period.to) return ` dari ${spokenDay(period.from)} sampai ${spokenDay(period.to)}`;
  if (period?.from) return ` sejak ${spokenDay(period.from)}`;
  if (period?.to) return ` sampai ${spokenDay(period.to)}`;
  return '';
}

function countText(counts: CountFact, selected?: WorkStatus[], detail?: SummaryDetail) {
  if (selected?.length) {
    if (selected.length === 1) return `${counts.total} tugas tercatat dengan status ${statuses[selected[0]]}.`;
    if (detail === 'total') return `${counts.total} tugas tercatat dengan status ${selected.map((status) => statuses[status]).join(' atau ')}.`;
    return `${counts.total} tugas cocok. ${selected.map((status) => `${counts[status]} ${statuses[status]}`).join(' dan ')}.`;
  }
  if (detail === 'total') return `${counts.total} tugas tercatat.`;
  return `${counts.total} tugas tercatat. ${counts.pending} pending, ${counts.on_progress} sedang dikerjakan, dan ${counts.done} selesai.`;
}

export function spokenFacts(facts: CeoFacts, summaryDetail?: SummaryDetail) {
  const name = target(facts.entity);
  const at = facts.asOf ? ` per ${spokenDay(facts.asOf)}` : '';
  const period = periodText(facts.period);
  if (facts.focusUpdatedAt && facts.updatedAt) {
    return `Terakhir diperbarui ${spokenTime(facts.updatedAt)}, untuk ${name}${at}.`;
  }
  if (facts.intent === 'summary' && facts.counts) {
    return `Menurut ${name}${period}${at}, ${countText(facts.counts, facts.statusFilter, summaryDetail)}`;
  }
  if (facts.intent === 'history') {
    const lines = facts.history.map((event) => {
      const day = spokenDay(event.changedAt);
      return event.previousStatus
        ? `Pada ${day}, status berubah dari ${statuses[event.previousStatus]} menjadi ${statuses[event.status]}.`
        : `Pada ${day}, status tercatat ${statuses[event.status]}.`;
    });
    return `Riwayat status tercatat untuk ${name}${period}${at}. ${lines.join(' ')}`;
  }
  if (facts.intent === 'pic') {
    if (facts.entity?.kind === 'task') {
      return facts.picName
        ? `${cleanLabel(facts.picName)} adalah PIC ${name}${at}.`
        : `PIC ${name}${at} belum tercatat.`;
    }
    if (!facts.tasks.length) return `Belum ada tugas dengan PIC tercatat untuk ${name}${period}${at}.`;
    const lines = facts.tasks.map((task) => `${cleanLabel(task.title)} ditangani ${task.picName ? cleanLabel(task.picName) : 'PIC yang belum tercatat'}.`);
    const sample = facts.counts && facts.counts.total > facts.tasks.length ? ` Saya bacakan ${facts.tasks.length} tugas dari ${facts.counts.total} yang tercatat.` : '';
    return `Timesheet mencatat PIC per tugas untuk ${name}${period}${at}.${sample} ${lines.join(' ')}`;
  }
  if (facts.status) {
    return `Status ${name}${at} ${statuses[facts.status]}.`;
  }
  return `Belum ada status tercatat untuk ${name}${period}${at}.`;
}
