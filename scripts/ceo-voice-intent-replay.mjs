import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import { createApp } from '../backend/app.ts';
import { readConfig } from '../backend/config.ts';
import { devCeoEmail } from '../backend/db/admin-account.ts';
import { openBudget } from '../backend/modules/ai/budget.ts';
import { readVoiceConfig } from '../backend/modules/ai/config.ts';
import { readVoiceTest } from '../backend/modules/ai/voice/history/report.ts';
import { createOpenAiIntentInterpreter } from '../backend/modules/ai/retrieval/openai-intent.ts';
import { deliverVerifiedAudio } from '../backend/tests/voice-output-fixture.ts';
import { openPilotDb } from './ceo-voice-pilot-db.mjs';
import { preparePilotEmbeddingRows, semantic, waitForPilotEmbeddings } from './ceo-voice-pilot-embeddings.mjs';
import { compareBackend } from './ceo-voice-pilot-report.mjs';
import { cases, insertPilotScenarioRows } from './ceo-voice-pilot-scenarios.mjs';
import { transcriptCases } from './ceo-voice-pilot-transcript-cases.mjs';

const [tag, caseIds] = process.argv.slice(2);
if (!/^[a-z0-9-]{1,40}$/u.test(tag ?? '')) throw new Error('Berikan label replay yang unik.');
const defaults = ['new-status-done', 'new-pic', 'new-count', 'new-history', 'active-scoped-duplicate',
  'active-pic-paraphrase', 'active-context-pic', 'active-correct-project', 'standby-correct-period',
  'standby-correct-division', 'ambiguous-duplicate', 'ambiguous-task-prefix'];
const requested = (caseIds?.split(',') ?? defaults).map((value) => value.trim());
const dateGap = {
  id: 'historical-date-gap', mode: 'new', text: 'Apa status proyek Pembaruan Gerbang per 25 November 2020?',
  expect: { kind: 'clarify', candidateName: '25 November 2020' },
};
const scopeFixture = transcriptCases.find(({ id }) => id === 'transcript-new-scope-tail');
const scopeTrace = { ...scopeFixture, id: 'recorded-scope-tail',
  text: 'Sebelum lanjut, apakah ada informasi status proyek sinkronisasi arsip khusus di divisi finance?' };
const catalog = [...cases, ...semantic, ...transcriptCases, dateGap, scopeTrace];
const selected = requested.map((id) => catalog.find((entry) => entry.id === id));
if (selected.some((entry) => !entry || entry.action)) throw new Error('Pilih kasus fixture yang bisa diputar ulang tanpa media.');
const embeddingsEnabled = selected.some((entry) => semantic.includes(entry));

const origin = 'http://127.0.0.1:3802';
const sessions = '/api/ceo/voice/sessions';
const reportDirectory = '.voice-pilot/luna-results';
const reportFile = `${reportDirectory}/intent-replay-${tag}.json`;
await mkdir(reportDirectory, { recursive: true, mode: 0o700 });
const report = { transport: 'synthetic-event-replay', scope: 'real-luna-and-postgresql', requested, samples: [] };
await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });

process.env.AI_VOICE_TEST_HISTORY_ENABLED = 'true';
process.env.AI_EMBEDDINGS_ENABLED = String(embeddingsEnabled);
const config = readVoiceConfig();
if (config?.intentModel !== 'gpt-6-luna') throw new Error('Aktifkan konfigurasi suara dengan GPT-6 Luna.');
const interpretLive = createOpenAiIntentInterpreter({
  apiKey: config.apiKey, model: config.intentModel,
  timeoutMs: config.retrievalTimeoutMs,
  inputMicrosPerToken: config.intentInputMicrosPerToken, outputMicrosPerToken: config.intentOutputMicrosPerToken,
  budget: openBudget(config.budgetUsd * 0.1, '.voice-pilot/embeddings-budget.json'),
});

let handlers;
let calls = [];
let interpretations = [];
let app;
const adapter = {
  async createSession() { return { id: 'synthetic-transport', sdp: 'synthetic-answer' }; },
  async attach(_id, next) {
    handlers = next;
    return {
      sendCommentary(eventId, turnId, text) {
        calls.push({ turnId, text });
        setImmediate(() => deliverVerifiedAudio(next.onEvent, eventId, text, Number(turnId.split('-').at(-1)) * 10_000 + 2_000));
      },
      finish: async () => true,
    };
  },
  async closeSession() { handlers?.onEvent({ type: 'closed', seconds: 0 }); },
};

const database = await openPilotDb({ ...process.env, APP_ORIGIN: origin }, async (db) => {
  await insertPilotScenarioRows(db);
  if (embeddingsEnabled) await preparePilotEmbeddingRows(db);
});
try {
  app = await createApp(readConfig(database.environment), { voiceAudit: {
    adapter,
    async interpret(input) {
      const result = await interpretLive(input);
      interpretations.push({ transcript: input.transcript, currentTitleHints: input.currentTitleHints, scopeRecheck: input.scopeRecheck, result });
      return result;
    },
  } });
  if (embeddingsEnabled) report.warmEmbeddings = await waitForPilotEmbeddings(database.db, config.embeddingModel);
  const signedIn = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', headers: { origin },
    payload: { email: devCeoEmail, password: process.env.SEED_PASSWORD } });
  if (signedIn.statusCode !== 200) throw new Error('Login fixture untuk replay gagal.');
  const cookies = Array.isArray(signedIn.headers['set-cookie']) ? signedIn.headers['set-cookie'] : [signedIn.headers['set-cookie']];
  const headers = { origin, cookie: cookies.filter(Boolean).map((cookie) => cookie.split(';')[0]).join('; ') };

  for (const fixture of selected) {
    calls = [];
    interpretations = [];
    const sample = { id: fixture.id, mode: fixture.mode, expected: fixture.expect, interpretations };
    report.samples.push(sample);
    const opened = await app.inject({ method: 'POST', url: sessions, headers, payload: { sdp: 'v=0\r\ns=synthetic-intent-replay\r\n' } });
    if (opened.statusCode !== 201) throw new Error(`Pembuatan sesi replay gagal dengan HTTP ${opened.statusCode}.`);
    const id = opened.json().id;
    try {
      const exchanges = [...(fixture.setup ?? []), fixture];
      for (const [index, exchange] of exchanges.entries()) {
        if (exchange === fixture && fixture.mode === 'standby') handlers.onEvent({ type: 'standby' });
        handlers.onEvent({ type: 'active' });
        const offset = (index + 1) * 10_000;
        const turnId = `replay-${index + 1}`;
        handlers.onEvent({ type: 'transcript', fragment: { eventId: `input-${index}`, role: 'user',
          text: exchange.text, startMs: offset + 200, endMs: offset + 1_200 } });
        handlers.onEvent({ type: 'delegation', id: turnId, offsetMs: offset + 1_200 });
        const deadline = performance.now() + 10_000;
        while (performance.now() < deadline && !calls.some((call) => call.turnId === turnId)) await wait(50);
        if (!calls.some((call) => call.turnId === turnId)) throw new Error(`Backend belum menjawab ${turnId}.`);
        // Let the simulated, already authoritative readout finish so follow-ups exercise committed context.
        await wait(400);
      }
      const journal = await readVoiceTest(database.db, id);
      sample.backend = compareBackend(fixture.expect, journal);
      sample.reply = calls.at(-1)?.text;
      sample.journal = journal;
    } catch (error) {
      sample.error = error.message;
    } finally {
      await app.inject({ method: 'DELETE', url: `${sessions}/${id}`, headers });
    }
    console.log(JSON.stringify({ id: sample.id, correct: sample.backend?.resultMatches ?? false, reply: sample.reply, error: sample.error }));
    await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  }
} finally {
  await app?.close();
  await database.close();
}
if (!report.samples.every((sample) => sample.backend?.resultMatches)) process.exitCode = 1;
