import type { WorkStatus } from '../../work-status.js';
import { matchDivision } from './division-scope.js';
import type { CeoRequest, CeoRetrievalContext, DivisionRef } from './request-types.js';
import type { CeoIntent } from './schema.js';
import { parseTemporal } from './temporal.js';
import { phraseIndex, wordsOf } from './words.js';

const forbidden = new Set(['ubah', 'hapus', 'pecat', 'rekomendasikan', 'analisis', 'gaji', 'penggajian', 'bonus', 'absensi', 'sanksi']);
const summary = new Set(['rekap', 'ringkasan', 'jumlah', 'total', 'berapa', 'daftar']);
const projectWords = new Set(['proyek', 'projek', 'project']);
const taskWords = new Set(['tugas', 'pekerjaan', 'task']);
const latestWords = new Set(['terakhir', 'terbaru', 'terkini', 'sekarang', 'saatini']);
const statusWords = new Set(['status', 'progres', 'progress', 'perkembangan', 'update']);
const referring = new Set(['tadi', 'itu', 'tersebut', 'barusan']);
const fillers = new Set([
  'bagaimana', 'gimana', 'apakah', 'apa', 'saja', 'mana', 'siapa', 'pic', 'penanggung', 'jawab', 'penanggungjawab', 'tanggung',
  'tolong', 'mohon', 'coba', 'berapa', 'lihat', 'cek', 'tampilkan', 'sebutkan', 'kasih', 'tahu', 'yang', 'untuk', 'kalau', 'dari',
  'di', 'tentang', 'terkait', 'dan', 'pada', 'dalam', 'dengan', 'masih', 'sudah', 'ya', 'dong', 'deh', 'nih', 'itu', 'tersebut',
  'tadi', 'barusan', 'nya', 'kah', 'riwayat', 'histori', 'perubahan', 'berubah', 'dipindah', 'dikerjakan', 'mengerjakan', 'ditangani',
  'memegang', 'pegang', 'pengerjaan', 'dikerjain', 'kapan', 'tolong', 'semua', 'divisi', 'departemen', 'tim', 'catatan', 'timesheet',
  'akhir', 'awal', 'lalu', 'selama', 'saat', 'ini', 'masalah', 'pembaruan', 'berhasil', 'saya', 'maksud', 'maksudnya',
  'diperbarui', 'diperbaharui', 'diupdate',
]);

export type IntentResult =
  | { kind: 'request'; request: CeoRequest }
  | { kind: 'clarify' | 'unsupported'; text: string };

function detectIntent(words: string[]): CeoIntent | undefined {
  if (words.some((word) => ['riwayat', 'histori'].includes(word)) || phraseIndex(words, ['perubahan', 'status']) >= 0
    || (words.includes('kapan') && words.includes('status') && words.includes('berubah'))) return 'history';
  if (words.some((word) => ['pic', 'penanggungjawab', 'ditangani'].includes(word)) || phraseIndex(words, ['penanggung', 'jawab']) >= 0
    || (words.includes('siapa') && words.some((word) => ['pegang', 'mengerjakan', 'dikerjakan', 'pengerjaan'].includes(word)))) return 'pic';
  if (words.some((word) => summary.has(word)) || phraseIndex(words, ['apa', 'saja']) >= 0) return 'summary';
  if (words.some((word) => statusWords.has(word)) || phraseIndex(words, ['sudah', 'selesai']) >= 0
    || asksUpdatedAt(words)
    || (words.some((word) => ['terakhir', 'bagaimana', 'gimana'].includes(word))
      && words.some((word) => projectWords.has(word) || taskWords.has(word)))) return 'status';
}

function asksUpdatedAt(words: string[]) {
  return words.includes('kapan') && words.some((word) => ['diperbarui', 'diperbaharui', 'diupdate', 'pembaruan', 'update'].includes(word));
}

function filterStatuses(words: string[]) {
  if (phraseIndex(words, ['belum', 'selesai']) >= 0 || phraseIndex(words, ['tidak', 'selesai']) >= 0) return ['pending', 'on_progress'] satisfies WorkStatus[];
  if (phraseIndex(words, ['sedang', 'berjalan']) >= 0 || phraseIndex(words, ['on', 'progress']) >= 0) return ['on_progress'] satisfies WorkStatus[];
  if (words.includes('pending')) return ['pending'] satisfies WorkStatus[];
  if (words.some((word) => ['selesai', 'done'].includes(word))) return ['done'] satisfies WorkStatus[];
}

function correctionText(text: string, fullWords: string[]) {
  const denial = fullWords.indexOf('bukan');
  if (denial < 0) return { words: fullWords, correction: false };
  const tail = fullWords.findIndex((word, index) => index > denial && ['melainkan', 'tapi', 'maksudnya'].includes(word));
  if (tail >= 0) return { words: fullWords.slice(tail + 1), correction: true };
  const explicit = phraseIndex(fullWords, ['maksud', 'saya'], denial + 1);
  if (explicit >= 0) return { words: fullWords.slice(explicit + 2), correction: true };
  const separator = text.lastIndexOf(',');
  if (separator >= 0 && wordsOf(text.slice(0, separator)).includes('bukan')) {
    return { words: wordsOf(text.slice(separator + 1)), correction: true };
  }
  return { words: [], correction: true };
}

export function parseCeoIntent(transcript: string, divisions: DivisionRef[], now: Date, context?: CeoRetrievalContext): IntentResult {
  const allWords = wordsOf(transcript);
  if (allWords.some((word) => forbidden.has(word)) || phraseIndex(allWords, ['berapa', 'persen']) >= 0) {
    return { kind: 'unsupported', text: 'Saya bisa membacakan status, PIC, riwayat, atau rekap yang tercatat di timesheet.' };
  }
  const { words, correction } = correctionText(transcript, allWords);
  if (correction && !words.length) return { kind: 'clarify', text: 'Baik. Apa nama proyek, tugas, divisi, atau periode yang Anda maksud?' };
  const previous = context?.request;
  const explicitIntent = detectIntent(words) ?? detectIntent(allWords);
  const hasReference = words.some((word) => referring.has(word));
  const timeIntent = explicitIntent ?? previous?.intent;
  const temporal = parseTemporal(words, now, timeIntent === 'summary' || correction, timeIntent === 'status' || timeIntent === 'pic');
  const scoped = matchDivision(words, divisions, correction, temporal.consumed);
  const hasFollowUp = correction || hasReference || Boolean(scoped.division || temporal.period || temporal.asOf);
  const intent = explicitIntent ?? (hasFollowUp ? previous?.intent : undefined);
  if (!intent) return { kind: 'unsupported', text: 'Saya bisa membantu dengan status, PIC, riwayat, dan rekap timesheet. Apa yang ingin Anda lihat?' };
  if (scoped.error) return { kind: 'clarify', text: scoped.error };
  if (temporal.error) return { kind: 'clarify', text: temporal.error };

  const entityKind = words.some((word) => projectWords.has(word)) ? 'project' : words.some((word) => taskWords.has(word)) ? 'task' : undefined;
  const latest = words.some((word, index) => latestWords.has(word) && !temporal.consumed.has(index));
  const statuses = intent === 'summary' ? filterStatuses(words) : undefined;
  const subjectWords = words.filter((word, index) => !scoped.consumed.has(index) && !temporal.consumed.has(index)
    && !fillers.has(word) && !summary.has(word) && !statusWords.has(word) && !projectWords.has(word) && !taskWords.has(word)
    && !latestWords.has(word) && !['selesai', 'done', 'belum', 'sedang', 'berjalan', 'pending', 'on'].includes(word));
  const subject = subjectWords.join(' ') || undefined;
  const inherit = previous && (!subject || hasReference || correction);
  const changedDivision = scoped.division && scoped.division.id !== previous?.division?.id;
  const reusable = inherit && !subject && !changedDivision && (!entityKind || entityKind === previous.entity?.kind) ? previous.entity : undefined;
  const implicitDivisionSummary = intent === 'status' && !subject && scoped.division && !entityKind && !correction && (!previous || !hasReference);

  return {
    kind: 'request',
    request: {
      intent: implicitDivisionSummary ? 'summary' : intent,
      subject: subject ?? (inherit && changedDivision ? previous.subject ?? previous.entity?.name : undefined),
      entityKind: entityKind ?? (inherit && !subject ? previous.entityKind : undefined),
      entity: implicitDivisionSummary ? undefined : reusable,
      division: scoped.division ?? (inherit ? previous.division : undefined),
      period: temporal.period ?? (!temporal.asOf && !latest && inherit ? previous.period : undefined),
      asOf: temporal.asOf ?? (!temporal.period && !latest && inherit ? previous.asOf : undefined),
      statuses: statuses ?? (intent === 'summary' && inherit && !explicitIntent ? previous.statuses : undefined),
      focusUpdatedAt: asksUpdatedAt(words) || undefined,
      latest,
    },
  };
}
