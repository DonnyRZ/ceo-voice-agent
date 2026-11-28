import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const origin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:5173').origin;
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Use only a local test application.');
const directory = await mkdtemp(join(tmpdir(), 'rk-pwa-smoke-'));
const output = resolve('test-results/pwa-native');
for (const folder of ['config', 'cache', 'data']) await mkdir(join(directory, folder));
await mkdir(output, { recursive: true });
const context = await chromium.launchPersistentContext(join(directory, 'profile'), {
  headless: false, viewport: null,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  env: { ...process.env, XDG_CONFIG_HOME: join(directory, 'config'),
    XDG_CACHE_HOME: join(directory, 'cache'), XDG_DATA_HOME: join(directory, 'data') },
});
const watchdog = setTimeout(() => { void context.close(); }, 90000);
let cdp;
let installed = false;
try {
  const page = await context.newPage();
  await page.goto(origin + '/login');
  cdp = await context.newCDPSession(page);
  const manifest = await cdp.send('Page.getAppManifest');
  assert.equal(manifest.errors.length, 0);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(installabilityErrors, []);
  await cdp.send('PWA.install', { manifestId: origin + '/', installUrlOrBundleUrl: origin + '/login' });
  installed = true;
  // Select the user's "open as window" preference on this isolated test profile.
  await cdp.send('PWA.changeAppUserSettings', { manifestId: origin + '/', displayMode: 'standalone', linkCapturing: true });
  const osState = await cdp.send('PWA.getOsAppState', { manifestId: origin + '/' });
  const related = await page.evaluate(async () => navigator.getInstalledRelatedApps?.() ?? []);
  assert.ok(related.some((app) => app.platform === 'webapp' && app.url === origin + '/manifest.webmanifest'));
  await cdp.send('PWA.launch', { manifestId: origin + '/', url: origin + '/launch?source=native-test' });
  let app;
  const deadline = Date.now() + 10000;
  do {
    for (const candidate of context.pages()) {
      if (candidate === page || candidate.url() === 'about:blank') continue;
      if (await candidate.evaluate(() => matchMedia('(display-mode: standalone)').matches).catch(() => false)) app = candidate;
    }
    if (app) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.ok(app, 'A real standalone app window must open.');
  await app.waitForURL(origin + '/login');
  await app.screenshot({ path: join(output, 'standalone-login.png') });
  await app.close();
  await page.route('**/api/registration/status', (route) => route.fulfill({ json: { registration: {
    name: 'Native installation fixture', email: 'fixture@egiresources.com', division_id: 'fixture', verified: true, delivery: 'sent',
    origin_device: 'mobile', retry_after_seconds: 0, sends_remaining: 4,
  } } }));
  await page.goto(origin + '/onboarding?step=android-install');
  await page.getByRole('link', { name: 'Buka Ruang Kerja', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Buka Ruang Kerja', exact: true }).click();
  let linkOutcome;
  const openingDeadline = Date.now() + 10000;
  do {
    for (const candidate of context.pages()) {
      if (candidate === page || candidate.url() === 'about:blank') continue;
      if (await candidate.evaluate(() => matchMedia('(display-mode: standalone)').matches).catch(() => false)) {
        linkOutcome = 'standalone'; break;
      }
      if (new URL(candidate.url()).pathname === '/launch') {
        await candidate.getByRole('heading', { name: 'Buka aplikasi terpasang' }).waitFor();
        linkOutcome = 'manual-guide'; break;
      }
    }
    if (!linkOutcome) await new Promise((resolve) => setTimeout(resolve, 100));
  } while (!linkOutcome && Date.now() < openingDeadline);
  assert.ok(linkOutcome, 'The opening button must produce an app window or the documented manual guide.');
  await writeFile(join(output, 'evidence.json'), JSON.stringify({
    testedAt: new Date().toISOString(), platform: 'Linux desktop Chromium',
    manifestErrors: manifest.errors, installabilityErrors, osState,
    selfDetected: related.some((item) => item.url === origin + '/manifest.webmanifest'),
    standalone: true, userDisplayMode: 'standalone selected through CDP', launchDestination: '/login', openingLinkOutcome: linkOutcome,
    limitation: 'This verifies desktop installation. Android WebAPK and iPhone Safari require real-device verification.',
  }, null, 2));
  console.log('Manifest, real installation, installed-app detection and standalone launch passed.');
} finally {
  clearTimeout(watchdog);
  if (installed && cdp) await cdp.send('PWA.uninstall', { manifestId: origin + '/' }).catch(() => {});
  await context.close();
  await rm(directory, { recursive: true, force: true });
}
