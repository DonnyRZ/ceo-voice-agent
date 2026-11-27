import { Info } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { taskDate } from '../../timesheets/task-dates';

function sourceDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}

export function voiceSourceContext(params: URLSearchParams) {
  const asOf = sourceDay(params.get('voiceAsOf'));
  const from = sourceDay(params.get('voiceFrom'));
  const to = sourceDay(params.get('voiceTo'));
  return { asOf, from: from && to && from > to ? undefined : from, to: from && to && from > to ? undefined : to };
}

export function withVoiceSource(path: string, params: URLSearchParams) {
  const [pathname, query] = path.split('?');
  const next = new URLSearchParams(query);
  const context = voiceSourceContext(params);
  for (const [key, value] of Object.entries({ voiceAsOf: context.asOf, voiceFrom: context.from, voiceTo: context.to })) {
    if (value) next.set(key, value);
  }
  return `${pathname}${next.size ? `?${next}` : ''}`;
}

export function CeoVoiceSourceNote() {
  const [params] = useSearchParams();
  const { asOf, from, to } = voiceSourceContext(params);
  if (!asOf && !from && !to) return null;
  const period = from && to ? `periode ${taskDate(from)} hingga ${taskDate(to)}`
    : from ? `tanggal awal periode ${taskDate(from)}` : to ? `tanggal akhir periode ${taskDate(to)}` : '';

  return <aside className="ceo-source-note" role="note" aria-label="Konteks sumber jawaban suara">
    <Info aria-hidden="true" /><div>
      <strong>Sumber jawaban suara</strong>
      <p>Jawaban suara merujuk {asOf && `status per ${taskDate(asOf)}`}{asOf && period && ' dan '}{period}.</p>
      <p>Detail di bawah menampilkan catatan dan status terkini, sehingga dapat berbeda dari jawaban historis tersebut.</p>
    </div>
  </aside>;
}
