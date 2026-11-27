import { seededTaskId } from '../backend/db/seed-data.ts';

const statuses = { pending: 'pending', on_progress: 'sedang dikerjakan', done: 'selesai' };
const tasks = {
  login: task(1, 'Validasi alur login', 'on_progress'),
  notifikasi: task(2, 'Uji notifikasi', 'done', 'IT', 'Hakim'),
  perawatan: task(4, 'Jadwalkan perawatan server', 'pending'),
  backup: task(8, 'Uji pemulihan backup', 'done', 'IT', 'Doni'),
  alat: task(9, 'Perbarui alat pemantauan', 'pending'),
  transaksi: task(11, 'Rekonsiliasi transaksi', 'on_progress', 'Finance', 'Laura'),
};
const projects = {
  sso: project(2, 'Integrasi Sistem SSO', 'on_progress'),
  arsip: project(102, 'Sinkronisasi Arsip', 'on_progress', 'Finance'),
  gerbang: project(103, 'Pembaruan Gerbang', 'done'),
};

function task(id, name, status, divisionName = 'IT', picName) {
  return { entity: { id: seededTaskId(id), kind: 'task', name, divisionName }, status, picName };
}

function project(id, name, status, divisionName = 'IT') {
  const uuid = `ea0e00b0-301c-4000-8000-${String(id).padStart(12, '0')}`;
  return { entity: { id: uuid, kind: 'project', name, divisionName }, status };
}

function status(work, fields = {}) {
  return { kind: 'facts', facts: { intent: 'status', entity: work.entity, status: work.status, ...fields },
    firstFact: statuses[fields.status ?? work.status] };
}

const pic = (work) => ({
  kind: 'facts', facts: { intent: 'pic', entity: work.entity, picName: work.picName }, firstFact: work.picName,
});
const prepare = (work) => [{
  text: `Apa status ${work.entity.kind === 'task' ? 'tugas' : 'proyek'} ${work.entity.name}?`,
  expect: status(work),
}];
const trial = (id, mode, text, expect, setup = [], action) => ({
  id: `transcript-${id}`, category: 'diagnostic', mode, text, expect, setup, action,
});

export const transcriptCases = [
  trial('new-task', 'new', 'Menurut catatan, apakah tugas Uji notifikasi sudah selesai?', status(tasks.notifikasi)),
  trial('new-acronym', 'new', 'Bagaimana status proyek Integrasi Sistem S S O di divisi I T?', status(projects.sso)),
  trial('new-scope-tail', 'new',
    'Sebelum lanjut, apakah ada informasi status proyek Sinkronisasi Arsip khusus di divisi Finance?',
    status(projects.arsip)),
  trial('active-task', 'active', 'Bagaimana status tugas Rekonsiliasi transaksi di divisi Finance?',
    status(tasks.transaksi), prepare(tasks.notifikasi)),
  trial('active-reference', 'active', 'Kalau tugas yang tadi, siapa penanggung jawabnya?',
    pic(tasks.transaksi), prepare(tasks.transaksi)),
  trial('active-title-action', 'active', 'Mohon cek status tugas Perbarui alat pemantauan.',
    status(tasks.alat), prepare(tasks.login)),
  trial('standby-task', 'standby', 'Apa status tugas Jadwalkan perawatan server?',
    status(tasks.perawatan), prepare(tasks.transaksi)),
  trial('standby-pic', 'standby', 'Siapa yang menangani tugas Uji pemulihan backup?',
    pic(tasks.backup), prepare(tasks.notifikasi)),
  trial('standby-date-tail', 'standby',
    'Bagaimana status proyek Pembaruan Gerbang pada tanggal dua puluh lima November dua ribu dua puluh enam?',
    status(projects.gerbang, { status: 'pending', asOf: '2026-11-25T23:59:59.999999+07:00' }), prepare(tasks.login)),
  trial('correct-inline', 'new',
    'Apa status tugas Validasi alur login, maaf, maksud saya tugas Uji notifikasi?',
    status(tasks.notifikasi)),
  trial('correct-active', 'active', 'Apa status tugas Perbarui alat pemantauan?',
    status(tasks.transaksi), prepare(tasks.notifikasi), {
      kind: 'interrupt', delayMs: 700,
      text: 'Maaf, pertanyaannya berubah. Apa status tugas Rekonsiliasi transaksi?',
    }),
  trial('correct-standby', 'standby', 'Boleh lihat status tugas Uji notifikasi?',
    status(tasks.perawatan), prepare(tasks.login), {
      kind: 'interrupt', delayMs: 1_250,
      text: 'Sebentar, yang benar tugas Jadwalkan perawatan server. Apa statusnya?',
    }),
];
