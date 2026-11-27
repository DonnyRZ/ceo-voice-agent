import { setTimeout as wait } from 'node:timers/promises';
import { finance, it } from '../backend/db/seed-data.ts';

const projects = [
  { id: 'ea0e00b0-301c-4000-8000-000000000351', division: it, name: 'Pemulihan Layanan Pesan',
    description: 'Proyek ini membuat cadangan surat elektronik agar tim bisa mengambil kembali pesan yang terhapus.',
    request: 'Bagaimana progres proyek yang menolong pegawai mendapatkan kembali surel yang hilang?' },
  { id: 'ea0e00b0-301c-4000-8000-000000000352', division: finance, name: 'Catatan Perjalanan Dinas',
    description: 'Program penggantian biaya tiket dan akomodasi pegawai saat bekerja ke luar kota.',
    request: 'Apa kabar proyek bayaran kembali ongkos kereta dan penginapan untuk staf yang ditugaskan ke luar daerah?' },
  { id: 'ea0e00b0-301c-4000-8000-000000000353', division: it, name: 'Peningkatan Ruang Mesin',
    description: 'Perbaikan penyejuk rak server dengan pendingin tambahan dan pemeriksaan suhu perangkat.',
    request: 'Sudah sampai mana proyek supaya komputer pusat tidak terlalu panas?' },
];

export const semantic = projects.map((project, index) => ({
  id: `semantic-${index + 1}`,
  mode: ['new', 'active', 'standby'][index],
  category: 'diagnostic',
  text: project.request,
  expect: { kind: 'clarify', candidateName: project.name },
}));

export async function preparePilotEmbeddingRows(db) {
  for (const { id, division, name, description } of projects) {
    await db.query(`INSERT INTO public.projects (id, division_id, name, description, status)
      VALUES ($1, $2, $3, $4, 'on_progress')`, [id, division, name, description]);
  }
  // Isolate this diagnostic to three records. The regular worker still performs vector writes.
  const ids = projects.map(({ id }) => id);
  await db.query(`UPDATE public.work_search_embeddings SET next_attempt_at = 'infinity'
    WHERE kind <> 'project' OR resource_id <> ALL($1::uuid[])`, [ids]);
}

export async function waitForPilotEmbeddings(db, model) {
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    const { rows: [row] } = await db.query(`SELECT count(*)::integer AS ready FROM public.work_search_embeddings
      WHERE kind = 'project' AND resource_id = ANY($1::uuid[]) AND model = $2 AND embedding IS NOT NULL`,
    [projects.map(({ id }) => id), model]);
    if (row.ready === projects.length) return row.ready;
    await wait(500);
  }
  throw new Error('Tiga embedding pilot belum siap dalam 30 detik.');
}
