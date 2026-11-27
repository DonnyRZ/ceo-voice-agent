import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, firefox } from 'playwright';
import { createApp } from '../backend/app.ts';
import { readConfig } from '../backend/config.ts';
import { installPilotAudio } from './ceo-voice-pilot-browser.mjs';

const password = process.env.SEED_PASSWORD;
const fixture = process.argv[2];
if (!password || !fixture || process.env.AI_VOICE_ENABLED !== 'true') {
  throw new Error('Siapkan akun CEO uji, wav pertanyaan, dan AI_VOICE_ENABLED=true.');
}

// Use a loopback server, a seeded account and nonproduction audio only.
const origin = 'http://127.0.0.1:3801';
const engine = process.env.PILOT_BROWSER === 'firefox' ? firefox : chromium;
const directory = resolve('.voice-pilot');
await mkdir(directory, { recursive: true, mode: 0o700 });
const wav = await readFile(fixture);
const report = { fixtureName: fixture.split('/').at(-1), browser: engine.name(), startup: [], samples: [] };
const config = readConfig({ ...process.env, APP_ORIGIN: origin, API_PORT: '3801', HOST: '127.0.0.1' });
const app = await createApp(config, { log: true, serveFrontend: true });
let browser;
let page;

try {
  await app.listen({ host: config.HOST, port: config.API_PORT });
  const browserProxy = engine === chromium && process.env.PILOT_BROWSER_PROXY === 'true' ? process.env.HTTPS_PROXY : undefined;
  browser = await engine.launch({
    executablePath: engine === chromium ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE : undefined,
    proxy: browserProxy ? { server: browserProxy, bypass: '127.0.0.1,localhost' } : undefined,
    ignoreDefaultArgs: engine === chromium ? ['--mute-audio'] : undefined,
    args: engine === firefox ? undefined : [
      '--disable-dev-shm-usage', '--auto-accept-this-tab-capture',
      ...(browserProxy ? ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] : []),
    ],
  });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(installPilotAudio);
  page.on('response', (response) => {
    if (response.request().method() === 'POST' && response.url().endsWith('/api/ceo/voice/sessions')) {
      report.startup.push(response.status());
    }
  });
  await page.goto(origin + '/ceo/voice');
  await page.getByLabel('Email perusahaan').fill('ceo@ruangkerja.test');
  await page.getByLabel('Kata sandi', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await page.getByRole('button', { name: /^Mulai (ngobrol|lagi)$/ }).click();
  const ready = page.getByText('Standby', { exact: true }).or(page.getByText('Mendengarkan', { exact: true }));
  await ready.or(page.getByRole('alert')).first().waitFor({ timeout: 18_000 });
  if (!await ready.first().isVisible()) throw new Error(await page.getByRole('alert').first().innerText());

  const scenarios = process.env.PILOT_ONE_TURN === 'true' ? ['awal'] : ['awal', 'aktif', 'bangun'];
  for (const scenario of scenarios) {
    if (scenario === 'bangun') await page.getByText('Standby', { exact: true }).waitFor({ timeout: 22_000 });
    const { recording, ...result } = await page.evaluate(
      ({ input, wait }) => window.voicePilot.speak(input, wait),
      { input: wav.toString('base64'), wait: 5_000 },
    );
    const card = await page.getByRole('main').innerText();
    const file = recording ? scenario + '.wav' : undefined;
    if (file) await writeFile(join(directory, file), Buffer.from(recording, 'base64'), { mode: 0o600 });
    report.samples.push({ scenario, ...result, file, card, factsAudited: false });
    if (result.connection === 'failed' || result.connection === 'closed') break;
  }
  await page.getByRole('button', { name: 'Akhiri sesi' }).click();
} catch (error) {
  report.error = error instanceof Error ? error.name + ': ' + error.message.split('\n')[0] : 'Pilot failed';
} finally {
  report.transport = await page?.evaluate(() => window.voicePilot?.transport()).catch(() => []);
  await browser?.close();
  await app.close();
  const filename = engine === firefox ? 'pilot-firefox.json' : 'pilot.json';
  await writeFile(join(directory, filename), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report));
}

if (report.error) process.exitCode = 1;
