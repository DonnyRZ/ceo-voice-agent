import type { VoiceFacts } from './voice-protocol';

const day = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Jakarta' });

export function voiceSourcePath(kind: 'project' | 'task' | 'division', id: string, facts: VoiceFacts) {
  const params = new URLSearchParams();
  if (facts.asOf && Number.isFinite(new Date(facts.asOf).getTime())) params.set('voiceAsOf', day.format(new Date(facts.asOf)));
  const { from, to } = facts.period ?? {};
  if (from) params.set('voiceFrom', from);
  if (to) params.set('voiceTo', to);
  if (from && to && /^[1-9]\d{3}-(0[1-9]|1[0-2])-01$/.test(from)) {
    const [year, month] = from.split('-').map(Number);
    const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    if (to === last) params.set('month', from.slice(0, 7));
  }
  const query = params.size ? `?${params}` : '';
  return `/ceo/${{ project: 'projects', task: 'tasks', division: 'divisions' }[kind]}/${encodeURIComponent(id)}${query}`;
}

export function voicePeriodLabel(period: VoiceFacts['period']) {
  if (period?.from && period.to) return `Periode ${period.from} – ${period.to}`;
  if (period?.from) return `Sejak ${period.from}`;
  if (period?.to) return `Sampai ${period.to}`;
  return null;
}
