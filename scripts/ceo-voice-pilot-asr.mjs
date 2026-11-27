import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { it } from '../backend/db/seed-data.ts';

const run = promisify(execFile);
const originals = [
  { id: 'active-updated', report: 'matrix-alignment-audio-v5.json',
    files: { 'smoke-new.wav': '3a2dbe941a42b748a25550ec60fc7286e8ff4b3c1bb100fb9d12f3421ea8579d',
      'active-updated.wav': '603fb705393af2b79b3192c1e090f3059f352f698d8eca5e07d43b31f62b567a' } },
  { id: 'holdout-task-25', report: 'holdout-alignment-date-v6.json',
    files: { 'holdout-task-25.wav': 'cbd28a4d56a4c1e82020c74495b302d6b60440b5d281bc619af382a88e4beb19' } },
  { id: 'standby-correct-period', report: 'matrix-alignment-audio-v4.json',
    files: { 'standby-correct-period-setup-1.wav': 'da23f73c664709713e2d6a57cbed5b2a8a558deb7e55879a486b4ad20ae41ad1',
      'standby-correct-period.wav': '4b3dbfc2bdd7c95a0b5f0500d81d6d5b5e3ea67d94b539e7b36e77e309e4de74' } },
];

const project = { kind: 'project', id: 'ea0e00b0-301c-4000-8000-000000000491',
  name: 'Pembaruan Jaringan', divisionName: 'IT', updatedAt: '2026-11-20T07:41:00.000Z', status: 'pending' };
const task = { kind: 'task', id: 'ea0e00b0-401c-4000-8000-000000000492',
  name: 'Salin Konfigurasi di Router', divisionName: 'IT', updatedAt: '2026-10-23T08:10:00.000Z', status: 'done' };

function control(id, text, { updatedAt, kind, id: entityId, name, divisionName }, firstFact) {
  const entity = { kind, id: entityId, name, divisionName };
  return { id, text, mode: 'new', category: 'routine', asr: { role: 'confusable' },
    expect: { kind: 'facts', facts: { intent: 'status', entity, focusUpdatedAt: true, updatedAt }, firstFact } };
}

const controls = [
  control('asr-confusable-project', 'Tolong cek proyek Pembaruan Jaringan. Kapan terakhir proyek itu diperbarui?',
    project, '20 November 2026 pukul 14.41 WIB'),
  control('asr-confusable-task', 'Kapan terakhir tugas Salin Konfigurasi di Router diperbarui?', task,
    '23 Oktober 2026 pukul 15.10 WIB'),
];

function originalClips(trial, manifest) {
  const setup = trial.setup?.length ? trial.setup : trial.mode === 'new' ? [] : [manifest.smoke?.[0]];
  return [...setup.map((turn) => turn?.speech), trial.speech];
}

export function validateAsrTrials(manifest, trials) {
  for (const original of originals) {
    const trial = trials.find(({ id }) => id === original.id);
    if (!trial) throw new Error(`Skenario ASR asli tidak tersedia: ${original.id}.`);
    const clips = originalClips(trial, manifest);
    const expected = Object.entries(original.files);
    if (clips.length !== expected.length || expected.some(([file, sha256], index) =>
      clips[index]?.file !== file || clips[index].sha256 !== sha256 || clips[index].source !== 'synthetic-espeak')) {
      throw new Error(`Fixture ASR asli berubah: ${trial.id}.`);
    }
  }
}

export async function prepareAsrManifest(originalPath) {
  const directory = dirname(resolve(originalPath));
  const manifest = JSON.parse(await readFile(originalPath, 'utf8'));
  const existing = [...manifest.cases, ...manifest.holdout];
  const trials = originals.map(({ id, report }) => ({
    ...existing.find((trial) => trial.id === id), id, asr: { role: 'original', report },
  }));
  validateAsrTrials(manifest, trials);
  for (const trial of trials) {
    for (const { file, sha256 } of originalClips(trial, manifest)) {
      const digest = createHash('sha256').update(await readFile(join(directory, file))).digest('hex');
      if (digest !== sha256) throw new Error(`Isi fixture ASR asli berubah: ${file}.`);
    }
  }
  const targetPath = join(directory, 'manifest-asr.json');
  const tempDirectory = await mkdtemp(join(tmpdir(), 'voice-asr-'));
  try {
    const binary = process.env.ESPEAK_NG || 'espeak-ng';
    const data = process.env.ESPEAK_NG_DATA ? [`--path=${process.env.ESPEAK_NG_DATA}`] : [];
    for (const [index, { text, ...trial }] of controls.entries()) {
      const file = `${trial.id}.wav`;
      const temp = join(tempDirectory, file);
      const voice = index ? 'id+f3' : 'id';
      await run(binary, [...data, '-v', voice, '-s', '150', '-w', temp, text]);
      const wav = await readFile(temp);
      await writeFile(join(directory, file), wav, { flag: 'wx', mode: 0o600 });
      const sha256 = createHash('sha256').update(wav).digest('hex');
      trials.push({ ...trial, speech: { text, file, voice, source: 'synthetic-espeak', sha256 }, setup: [] });
    }
    await writeFile(targetPath, JSON.stringify({ ...manifest, asr: trials }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return targetPath;
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
}

export async function insertAsrConfusableRows(db) {
  await db.query(`INSERT INTO public.projects (id, division_id, name, description, status, updated_at)
    VALUES ($1, $2, $3, 'Proyek sintetis pemeliharaan jaringan kantor.', $4, $5)`,
  [project.id, it, project.name, project.status, project.updatedAt]);
  await db.query(`INSERT INTO public.tasks (id, division_id, date, title, description, project_id, pic_id, status, updated_at)
    SELECT $1, $2, $3, $4, 'Tugas sintetis untuk router jaringan.', $5, member.id, $6, $7
    FROM public.members member WHERE member.division_id = $2 AND member.name = 'Doni'`,
  [task.id, it, task.updatedAt.slice(0, 10), task.name, project.id, task.status, task.updatedAt]);
}

if (import.meta.main) {
  if (!process.argv[2]) throw new Error('Gunakan node scripts/ceo-voice-pilot-asr.mjs MANIFEST_ASLI.json.');
  console.log(await prepareAsrManifest(process.argv[2]));
}
