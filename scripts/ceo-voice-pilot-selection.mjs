import { createHash } from 'node:crypto';
import { validateAsrTrials } from './ceo-voice-pilot-asr.mjs';

const phases = {
  smoke: { key: 'smoke', size: 3 },
  matrix: { key: 'cases', size: 30 },
  probe: { key: 'probe', size: 3, holdout: true },
  holdout: { key: 'holdout', size: 60, holdout: true },
  'holdout-special': { key: 'holdoutSpecial', size: 12, holdout: true },
  semantic: { key: 'semantic', size: 3 },
  transcript: { key: 'transcript', size: 12 },
  asr: { key: 'asr', size: 5, holdout: true },
};

export function selectPilotCases(manifest, phase, environment = process.env) {
  const definition = phases[phase];
  const available = definition && manifest[definition.key];
  if (manifest.version !== 1 || !Array.isArray(available) || available.length !== definition.size) {
    throw new Error('Manifest pilot tidak valid untuk fase yang dipilih.');
  }
  if (phase === 'semantic' && environment.PILOT_EMBEDDINGS_ENABLED !== 'true') {
    throw new Error('Fase semantic memerlukan PILOT_EMBEDDINGS_ENABLED=true.');
  }
  if (available.some((trial) => typeof trial.id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(trial.id))) {
    throw new Error('ID skenario pilot tidak valid.');
  }
  if (new Set(available.map(({ id }) => id)).size !== available.length) throw new Error('ID skenario pilot harus unik.');
  const asrCollisions = phase === 'asr' && environment.PILOT_ASR_COLLISIONS === 'true';
  if (phase === 'asr') validateAsrTrials(manifest, available);
  const cohort = phase === 'asr' && !asrCollisions ? available.filter(({ asr }) => asr?.role === 'original') : available;
  const ids = new Set(cohort.map(({ id }) => id));
  const requested = environment.PILOT_CASES?.split(',').map((id) => id.trim());
  if (requested && (!requested.length || new Set(requested).size !== requested.length || requested.some((id) => !ids.has(id)))) {
    throw new Error('PILOT_CASES memuat ID yang tidak tersedia pada fase ini.');
  }
  const byId = new Map(cohort.map((trial) => [trial.id, trial]));
  const chosen = requested ? requested.map((id) => byId.get(id)) : cohort;
  const limit = Number(environment.PILOT_LIMIT ?? chosen.length);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > chosen.length) {
    throw new Error('PILOT_LIMIT harus sesuai jumlah skenario yang dipilih.');
  }
  const selected = chosen.slice(0, limit);
  const used = (trial) => [trial.speech, ...(trial.setup ?? []).map(({ speech }) => speech), trial.action?.speech];
  const defaultWarmup = selected.some((trial) => trial.mode !== 'new' && !trial.setup?.length) ? manifest.smoke?.[0] : null;
  const humanAudio = [...selected.flatMap(used), ...(defaultWarmup ? used(defaultWarmup) : [])]
    .some((speech) => speech?.source === 'human-declared');
  if (phase === 'transcript' && humanAudio) {
    throw new Error('Fase transcript memakai fixture ucapan sintetis.');
  }
  if (humanAudio && environment.PILOT_ALLOW_HUMAN_AUDIO !== 'true') {
    throw new Error('Fase ini memuat rekaman yang dilabeli manusia. Gunakan hanya WAV yang diizinkan dikirim ke OpenAI.');
  }
  return { selected, fullSize: cohort.length, holdout: definition.holdout ?? false, asrCollisions };
}

export function pilotClipMetadata(speech, bytes) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (speech.sha256 && speech.sha256 !== sha256) throw new Error('Isi WAV berbeda dari manifest.');
  return { file: speech.file, source: speech.source ?? 'synthetic-espeak', sha256 };
}
