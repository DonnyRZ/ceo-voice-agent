import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { chromium } from 'playwright';
import { createApp } from '../backend/app.ts';
import { readConfig } from '../backend/config.ts';
import { devCeoEmail } from '../backend/db/admin-account.ts';
import { openBudget } from '../backend/modules/ai/budget.ts';
import { readVoiceConfig } from '../backend/modules/ai/config.ts';
import { createOpenAiIntentInterpreter } from '../backend/modules/ai/retrieval/openai-intent.ts';
import { readVoiceTest } from '../backend/modules/ai/voice/history/report.ts';
import { insertAsrConfusableRows } from './ceo-voice-pilot-asr.mjs';
import { installPilotAudio } from './ceo-voice-pilot-browser.mjs';
import { openPilotDb } from './ceo-voice-pilot-db.mjs';
import { observePilotDelivery } from './ceo-voice-pilot-delivery.mjs';
import { preparePilotEmbeddingRows, waitForPilotEmbeddings } from './ceo-voice-pilot-embeddings.mjs';
import { judgeVoiceInput, summarizeVoiceInput } from './ceo-voice-input-gate.mjs';
import { insertPilotHoldoutRows, insertPilotScenarioRows } from './ceo-voice-pilot-fixtures.mjs';
import { compareBackend, summarizePilot } from './ceo-voice-pilot-report.mjs';
import { assertSyntheticReflectionInputs, createPilotReflectionTrace } from './ceo-voice-pilot-reflection.mjs';
import { openPilotRelay } from './ceo-voice-pilot-relay.mjs';
import { pilotClipMetadata, selectPilotCases } from './ceo-voice-pilot-selection.mjs';

const [manifestPath, phase = 'smoke'] = process.argv.slice(2);
const tag = process.env.PILOT_RUN_TAG;
if (tag && !/^[a-z0-9-]{1,32}$/.test(tag)) throw new Error('Label pilot tidak valid.');
const origin = 'http://127.0.0.1:3801';
const resultsPath = resolve('.voice-pilot/luna-results');
const sessionsPath = '/api/ceo/voice/sessions';
const transcriptPhase = phase === 'transcript' || process.env.PILOT_TRANSCRIPT_ONLY === 'true';
const requireExactInput = process.env.PILOT_INPUT_EXACT === 'true';
const reflectionTrace = process.env.PILOT_REFLECTION_TRACE === 'true';
process.env.AI_VOICE_TEST_HISTORY_ENABLED = 'true';
const semantic = phase === 'semantic' && process.env.PILOT_EMBEDDINGS_ENABLED === 'true';
process.env.AI_EMBEDDINGS_ENABLED = String(semantic);
process.env.AI_VOICE_MAX_DURATION_SECONDS = '75';
process.env.AI_VOICE_STANDBY_SECONDS = '12';
const config = readVoiceConfig();
if (!manifestPath || config?.intentModel !== 'gpt-6-luna' || config.voiceModel !== 'gpt-live-1.1') {
  throw new Error('Siapkan manifest pilot, GPT Live 1.1, dan Luna.');
}
let intentDecisions = [];
const interpretLive = transcriptPhase && createOpenAiIntentInterpreter({
  apiKey: config.apiKey, model: config.intentModel,
  timeoutMs: config.retrievalTimeoutMs,
  budget: openBudget(config.budgetUsd * 0.1, '.voice-pilot/embeddings-budget.json'),
  inputMicrosPerToken: config.intentInputMicrosPerToken, outputMicrosPerToken: config.intentOutputMicrosPerToken,
});
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes);
const { selected, fullSize, holdout, asrCollisions } = selectPilotCases(manifest, phase);
if (reflectionTrace) assertSyntheticReflectionInputs(manifest, selected);
await mkdir(resultsPath, { recursive: true, mode: 0o700 });

async function fixture(speech, provenance) {
  if (!/^[a-z0-9-]+\.wav$/.test(speech.file)) throw new Error('Nama WAV pilot tidak valid.');
  const bytes = await readFile(join(dirname(manifestPath), speech.file));
  provenance.push(pilotClipMetadata(speech, bytes));
  return bytes.toString('base64');
}

async function revoke(db, revoked) {
  await db.query(`
    UPDATE account_access SET state = $2
    WHERE user_id = (SELECT id FROM "user" WHERE email = $1)
  `, [devCeoEmail, revoked ? 'revoked' : 'active']);
}

async function readJournal(db, id) {
  // The test journal flushes asynchronously in 200 ms batches.
  await wait(550);
  return readVoiceTest(db, id);
}

let activeTrace;
async function runCase({ browser, db, relay }, test) {
  const sample = { id: test.id, mode: test.mode, category: test.category, expect: test.expect, setup: [], inputClips: [],
    playbackReviewRequired: !transcriptPhase };
  if (transcriptPhase) {
    intentDecisions = [];
    sample.intentDecisions = intentDecisions;
  }
  if (test.asr) sample.asr = test.asr;
  if (transcriptPhase || test.asr) sample.transcriptExpected = {
    text: test.speech.text, interruptionText: test.action?.speech?.text,
    setupTexts: test.setup.map(({ speech }) => speech.text),
  };
  const context = await browser.newContext();
  const trace = reflectionTrace ? createPilotReflectionTrace() : undefined;
  activeTrace = trace;
  let sessionId;
  let beforeSequence = 0;
  let revoked = false;
  let page;
  let delivery;
  const metricStarted = performance.now();
  try {
    const login = await context.request.post(origin + '/api/auth/sign-in/email', {
      headers: { origin }, data: { email: devCeoEmail, password: process.env.SEED_PASSWORD }, timeout: 8_000,
    });
    if (!login.ok()) throw new Error(`Login akun uji HTTP ${login.status()}.`);
    page = await context.newPage();
    if (reflectionTrace) delivery = await observePilotDelivery(page, { origin, sessionsPath, session: () => sessionId });
    await page.addInitScript(installPilotAudio, { ...relay?.ice, captureOutput: !transcriptPhase });
    await page.goto(origin + '/ceo/voice');
    const startResponse = page.waitForResponse((response) =>
      response.url() === origin + sessionsPath && response.request().method() === 'POST', { timeout: 25_000 });
    void startResponse.catch(() => {});
    const clicked = performance.now();
    await page.getByRole('button', { name: /^Mulai (ngobrol|lagi)$/ }).click();
    const start = await startResponse;
    sample.startStatus = start.status();
    if (!start.ok()) throw new Error(`Pembuatan sesi HTTP ${start.status()}.`);
    sessionId = (await start.json()).id;
    const active = page.getByText('Mendengarkan', { exact: true });
    const standby = page.getByText('Standby', { exact: true });
    const ready = active.or(standby);
    const alert = page.getByRole('alert');
    await ready.or(alert).first().waitFor({ timeout: 24_000 });
    if (!await ready.first().isVisible()) throw new Error('WebRTC gagal menyambung.');
    sample.clickToReadyMs = Math.round(performance.now() - clicked);
    const speak = (input, listenMs, options) =>
      page.evaluate(({ base64, listenMs, options }) => window.voicePilot.speak(base64, listenMs, options),
        { base64: input, listenMs, options });
    const setup = test.setup?.length ? test.setup : test.mode === 'new' ? [] : [manifest.smoke[0]];
    for (const preparation of setup) {
      const { recording, ...capture } = await speak(await fixture(preparation.speech, sample.inputClips),
        transcriptPhase ? 7_500 : 16_000);
      sample.setup.push(capture);
    }
    const expectedCondition = test.mode === 'standby' ? standby : test.mode === 'active' ? active : null;
    if (expectedCondition) {
      try {
        await expectedCondition.waitFor({ timeout: test.mode === 'standby' ? 23_000 : 4_000 });
      } catch (error) {
        if (!transcriptPhase) throw error;
      }
    }
    sample.sessionCondition = { expected: test.mode,
      observed: await standby.isVisible() ? 'standby' : await active.isVisible() ? 'active' : null,
      matches: expectedCondition ? await expectedCondition.isVisible() : !setup.length };
    if (setup.length) {
      const journal = await readJournal(db, sessionId);
      beforeSequence = Math.max(journal?.events.at(-1)?.sequence ?? 0, journal?.transcriptEvents?.at(-1)?.sequence ?? 0);
      sample.setupBackend = compareBackend(setup.at(-1).expect, journal);
    }
    sample.beforeSequence = beforeSequence;
    delivery?.target();
    const options = { pulseSync: process.env.PILOT_PULSE_SYNC === 'true' };
    if (test.action?.kind === 'interrupt') {
      options.interrupt = { base64: await fixture(test.action.speech, sample.inputClips), delayMs: test.action.delayMs };
    }
    if (test.action?.kind === 'revoke') {
      options.revokeDelayMs = test.action.delayMs;
      await page.exposeFunction('voicePilotRevoke', async () => { await revoke(db, true); revoked = true; });
    }
    const { recording, ...capture } = await speak(await fixture(test.speech, sample.inputClips),
      transcriptPhase ? 13_000 : 28_000, options);
    sample.capture = capture;
    if (recording && Number.isFinite(capture.firstAudibleFrame)) {
      sample.recording = (tag ? tag + '-' : '') + test.id + '.wav';
      const wav = Buffer.from(recording, 'base64');
      sample.recordingSha256 = createHash('sha256').update(wav).digest('hex');
      await writeFile(join(resultsPath, sample.recording), wav, { mode: 0o600 });
    }
  } catch (error) {
    sample.error = error.message.split('\n')[0];
  } finally {
    let completeJournal;
    sample.media = await page?.evaluate(() => window.voicePilot.mediaStats()).catch(() => undefined);
    if (sessionId) {
      const close = await context.request.delete(origin + sessionsPath + '/' + encodeURIComponent(sessionId),
        { headers: { origin }, timeout: 8_000 }).catch(() => null);
      sample.closeStatus = close?.status();
      sample.sessionId = sessionId;
      const journal = await readJournal(db, sessionId);
      if (journal) {
        completeJournal = journal;
        const transcriptEvents = journal.transcriptEvents ?? [];
        const afterSetup = ({ sequence }) => sequence > beforeSequence;
        sample.journal = { ...journal, events: journal.events.filter(afterSetup),
          transcriptEvents: transcriptEvents.filter(afterSetup) };
        if ((transcriptPhase || test.asr) && beforeSequence) {
          sample.replayPrelude = {
            events: journal.events.filter((row) => !afterSetup(row)),
            transcriptEvents: transcriptEvents.filter((row) => !afterSetup(row)),
          };
        }
        sample.backend = compareBackend(test.expect, sample.journal);
      }
    }
    activeTrace = undefined;
    if (trace) {
      const prefix = (tag ? tag + '-' : '') + test.id;
      try {
        sample.providerTrace = await trace.save(resultsPath, prefix, completeJournal);
      } catch (error) {
        sample.providerTraceError = error.code ?? error.message.split('\n')[0];
      }
      try {
        const delivered = await delivery?.save(resultsPath, prefix);
        sample.playbackEvidence = delivered?.recordings;
        if (delivered) sample.playbackCapture = { source: delivered.captureSource, cleanupErrors: delivered.cleanupErrors };
        if (delivered?.overflow) sample.playbackEvidenceOverflow = true;
      } catch (error) {
        sample.playbackEvidenceError = error.code ?? error.message.split('\n')[0];
      }
    }
    await context.close();
    relay?.invalidate();
    if (revoked) await revoke(db, false);
    sample.wallMs = Math.round(performance.now() - metricStarted);
  }
  return sample;
}

let isolated;
let browser;
let app;
let relay;
const report = { phase, tag, provider: 'gpt-live-1.1', interpreter: config.intentModel, reasoningEffort: 'none',
  serviceTier: 'default', transport: 'browser-webrtc', limitUsd: config.budgetUsd, retrievalDeadlineMs: config.retrievalTimeoutMs,
  embeddingModel: config.embeddingModel,
  reflectionTrace, asrCollisions: phase === 'asr' ? asrCollisions : undefined,
  cohortSize: fullSize, manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
  planned: selected.length, plannedRoutine: selected.filter(({ category }) => category === 'routine').length, samples: [] };
const reportFile = join(resultsPath, phase + (tag ? '-' + tag : '') + '.json');
function summarizeRun() {
  if (!transcriptPhase) return summarizePilot(report.samples);
  const samples = report.samples;
  return { samples, summary: { attempted: samples.length,
    withRawUserTranscript: samples.filter(({ journal }) =>
      journal?.transcriptEvents.some(({ fragment }) => fragment.role === 'user')).length,
    withAssembledInput: samples.filter(({ journal }) => journal?.events.some(({ entry }) => entry.type === 'turn_input')).length,
  } };
}
function summarize() {
  const result = summarizeRun();
  if (requireExactInput) result.summary.inputAccuracy = summarizeVoiceInput(
    report.samples.flatMap(({ inputAccuracy }) => inputAccuracy ? [inputAccuracy] : []), report.planned,
  );
  return result;
}
const commitReport = (flag = 'w') => writeFile(reportFile,
  JSON.stringify({ ...report, ...summarize() }, null, 2) + '\n', { mode: 0o600, flag });
try {
  await commitReport('wx');
} catch (error) {
  if (error.code === 'EEXIST') throw new Error('Laporan ini sudah tersedia. Pilih PILOT_RUN_TAG baru.');
  throw error;
}
try {
  isolated = await openPilotDb({ ...process.env, APP_ORIGIN: origin, API_PORT: '3801', HOST: '127.0.0.1' }, async (db) => {
    await insertPilotScenarioRows(db);
    if (holdout) await insertPilotHoldoutRows(db);
    if (asrCollisions) await insertAsrConfusableRows(db);
    if (semantic) await preparePilotEmbeddingRows(db);
  });
  app = await createApp(readConfig(isolated.environment), { serveFrontend: true, voiceAudit: interpretLive || reflectionTrace ? {
    interpret: interpretLive ? async (input) => {
      const reportDecisions = intentDecisions;
      const decision = await interpretLive(input);
      reportDecisions.push({ input: input.transcript, currentTitleHints: input.currentTitleHints, scopeRecheck: input.scopeRecheck, decision });
      return decision;
    } : undefined,
    providerEvent: reflectionTrace ? (event) => activeTrace?.providerEvent(event) : undefined,
    commentarySent: reflectionTrace ? (eventId, delegationId, text) => activeTrace?.commentarySent(eventId, delegationId, text) : undefined,
  } : undefined });
  relay = await openPilotRelay();
  relay?.install(app);
  await app.listen({ host: '127.0.0.1', port: 3801 });
  if (semantic) report.warmEmbeddings = await waitForPilotEmbeddings(isolated.db, config.embeddingModel);
  const browserEnvironment = { ...process.env };
  for (const name of ['OPENAI_API_KEY', 'SEED_PASSWORD', 'DATABASE_URL', 'DATABASE_ADMIN_URL', 'BETTER_AUTH_SECRET']) {
    delete browserEnvironment[name];
  }
  browser = await chromium.launch({
    env: browserEnvironment,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    ignoreDefaultArgs: ['--mute-audio'],
    args: ['--auto-accept-this-tab-capture', '--disable-dev-shm-usage'],
  });
  const probe = await browser.newPage();
  try {
    await probe.addInitScript(installPilotAudio, relay?.ice);
    await probe.goto(origin + '/ceo/voice');
    report.ice = await probe.evaluate(() => window.voicePilot.probeIce());
    if (!report.ice.candidateCount) throw new Error('ICE tidak menemukan kandidat media di browser.');
  } finally {
    await probe.close();
  }
  for (const test of selected) {
    const sample = await runCase({ browser, db: isolated.db, relay }, test);
    if (requireExactInput) sample.inputAccuracy = judgeVoiceInput(sample, test.speech);
    report.samples.push(sample);
    await commitReport();
    const result = transcriptPhase
      ? { userFragments: sample.journal?.transcriptEvents.filter(({ fragment }) => fragment.role === 'user').length,
        assembledInputs: sample.journal?.events.filter(({ entry }) => entry.type === 'turn_input').length }
      : { ms: sample.capture?.firstAudibleMs, playback: Boolean(sample.recording), backendMatches: sample.backend?.matches };
    console.log(JSON.stringify({ id: sample.id, ...result, inputAccuracy: sample.inputAccuracy?.outcome, error: sample.error }));
    if (!sample.clickToReadyMs) {
      report.blocker = sample.error ?? 'Media WebRTC tidak tersambung.';
      break;
    }
  }
} catch (error) {
  report.blocker = error.message.split('\n')[0];
} finally {
  await browser?.close();
  await app?.close();
  await relay?.close();
  await isolated?.close();
  await commitReport();
}
console.log(JSON.stringify({ phase, blocker: report.blocker, summary: summarize().summary }));
if (report.blocker || report.samples.length !== selected.length ||
    (requireExactInput && report.samples.some((sample) => sample.inputAccuracy?.outcome !== 'passed'))) process.exitCode = 1;
