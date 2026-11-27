import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { cases, smoke } from './ceo-voice-pilot-scenarios.mjs';
import { holdout, holdoutSpecial, probe } from './ceo-voice-pilot-holdout.mjs';
import { semantic } from './ceo-voice-pilot-embeddings.mjs';
import { transcriptCases } from './ceo-voice-pilot-transcript-cases.mjs';

export { insertPilotScenarioRows } from './ceo-voice-pilot-scenarios.mjs';
export { insertPilotHoldoutRows } from './ceo-voice-pilot-holdout.mjs';

const execute = promisify(execFile);

export async function generatePilotFixtures(directory = '.voice-pilot/luna-fixtures', humanWavMap) {
  const output = resolve(directory);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const tool = process.env.ESPEAK_NG || 'espeak-ng';
  const data = process.env.ESPEAK_NG_DATA ? [`--path=${process.env.ESPEAK_NG_DATA}`] : [];
  const speechFiles = new Map();
  const declaredRecordings = humanWavMap ? JSON.parse(await readFile(humanWavMap, 'utf8')) : {};
  if (!declaredRecordings || Array.isArray(declaredRecordings) || typeof declaredRecordings !== 'object') {
    throw new Error('Peta rekaman suara harus berupa objek ID giliran ke nama WAV.');
  }
  const usedRecordings = new Set();

  async function speechFixture(text, id) {
    const suppliedFile = Object.hasOwn(declaredRecordings, id) ? declaredRecordings[id] : undefined;
    if (suppliedFile !== undefined) {
      if (typeof suppliedFile !== 'string' || !suppliedFile.toLowerCase().endsWith('.wav')) {
        throw new Error(`Rekaman untuk ${id} harus berupa WAV.`);
      }
      const bytes = await readFile(resolve(dirname(humanWavMap), suppliedFile));
      if (bytes.length < 44 || bytes.length > 10_000_000 ||
          bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
        throw new Error(`Format WAV untuk ${id} tidak valid.`);
      }
      const file = `${id}-human.wav`;
      await writeFile(join(output, file), bytes, { mode: 0o600 });
      usedRecordings.add(id);
      return { text, file, source: 'human-declared', sha256: createHash('sha256').update(bytes).digest('hex') };
    }
    const existing = speechFiles.get(text);
    if (existing) return existing;

    const file = `${id}.wav`;
    const target = join(output, file);
    const voice = speechFiles.size % 2 === 0 ? 'id' : 'id+f3';
    const pace = voice === 'id' ? '155' : '165';
    await execute(tool, [...data, '-v', voice, '-s', pace, '-w', target, text]);
    await chmod(target, 0o600);
    const sha256 = createHash('sha256').update(await readFile(target)).digest('hex');
    const result = { text, file, voice, source: 'synthetic-espeak', sha256 };
    speechFiles.set(text, result);
    return result;
  }

  async function prepare(scenarios) {
    const prepared = [];
    for (const { text, setup, action, ...fields } of scenarios) {
      const speech = await speechFixture(text, fields.id);
      const warmup = [];
      for (const [index, turn] of (setup ?? []).entries()) {
        warmup.push({ speech: await speechFixture(turn.text, `${fields.id}-setup-${index + 1}`), expect: turn.expect });
      }
      const preparedAction = action?.kind === 'interrupt'
        ? { kind: action.kind, delayMs: action.delayMs, speech: await speechFixture(action.text, `${fields.id}-interrupt`) }
        : action;
      prepared.push({ ...fields, speech, setup: warmup, action: preparedAction });
    }
    return prepared;
  }

  const manifest = {
    version: 1,
    audioSource: humanWavMap ? 'mixed-sources-by-file' : 'offline espeak-ng Indonesian text to speech',
    smoke: await prepare(smoke),
    cases: await prepare(cases),
    probe: await prepare(probe),
    holdout: await prepare(holdout),
    holdoutSpecial: await prepare(holdoutSpecial),
    semantic: await prepare(semantic),
    transcript: await prepare(transcriptCases),
  };
  const unknown = Object.keys(declaredRecordings).filter((id) => !usedRecordings.has(id));
  if (unknown.length) throw new Error(`ID rekaman di luar manifest: ${unknown.join(', ')}`);
  const file = join(output, 'manifest.json');
  await writeFile(file, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  return file;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(await generatePilotFixtures(process.argv[2], process.argv[3]));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      console.error('Pasang eSpeak NG dan suara Indonesia, atau atur ESPEAK_NG dan ESPEAK_NG_DATA.');
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  }
}
