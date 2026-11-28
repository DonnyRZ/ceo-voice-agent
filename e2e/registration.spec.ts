import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { submitLogin } from './session';
import { requireLocalSmtp } from './admin/mailpit';

test('registrasi perusahaan, email nyata ke Mailpit, aktivasi, login, dan isolasi divisi', async ({ page, browser }, info) => {
  requireLocalSmtp(); // All outgoing email is intercepted by a loopback-only SMTP server.
  const email = 'registration-' + randomUUID().slice(0, 12) + '@egiresources.com';
  const password = 'Onboarding-' + randomUUID();
  await page.goto('/login');
  await page.getByRole('link', { name: 'Daftar Anggota Divisi', exact: true }).click();
  await page.getByLabel('Nama lengkap', { exact: true }).fill('Anggota Registrasi QA');
  await page.getByLabel('Email perusahaan', { exact: true }).fill(email);
  await page.getByLabel('Divisi', { exact: true }).selectOption({ label: 'IT' });
  await page.getByLabel('Kata sandi', { exact: true }).fill(password);
  await page.getByLabel('Konfirmasi kata sandi', { exact: true }).fill(password);
  await page.getByRole('button', { name: info.project.name === 'mobile' ? 'Simpan dan lanjut' : 'Daftar', exact: true }).click();
  await expect(page).toHaveURL(info.project.name === 'mobile' ? /\/onboarding$/ : /\/register\/check-email$/);
  expect((await page.request.get('/api/session')).status()).toBe(401);

  const base = new URL(process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:8025');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Only local Mailpit is allowed.');
  let messageId: string | undefined;
  await expect.poll(async () => {
    const response = await fetch(new URL('/api/v1/search?' + new URLSearchParams({ query: 'to:' + email }), base));
    const data = await response.json() as { messages?: { ID: string }[] };
    messageId = data.messages?.[0]?.ID;
    return Boolean(messageId);
  }).toBe(true);
  const message = await (await fetch(new URL('/api/v1/message/' + messageId, base))).json() as { Text: string };
  const link = (message.Text.match(/https?:\/\/[^\s<>]+/g) ?? []).map((url) => new URL(url))
    .find((url) => url.pathname === '/register/verify');
  expect(link).toBeTruthy();
  expect(link!.origin).toBe(new URL(page.url()).origin);

  const verifyPage = await page.context().newPage();
  await verifyPage.goto(link!.href);
  await expect(verifyPage).toHaveURL(/\/register\/verify$/); // Secret fragment is removed before interaction.
  await verifyPage.getByRole('button', { name: 'Verifikasi email', exact: true }).click();
  await expect(verifyPage.getByRole('heading', { name: 'Email terverifikasi', exact: true })).toBeVisible();
  await verifyPage.close();
  await page.goto('/login');
  await submitLogin(page, email, password);
  await expect(page.getByRole('heading', { name: 'Dashboard Divisi', exact: true })).toBeVisible();
  expect((await page.request.get('/api/admin/users')).status()).toBe(403);
  expect((await page.request.get('/api/ceo/dashboard')).status()).toBe(403);
  const members = await (await page.request.get('/api/members')).json() as { name: string }[];
  expect(members.some((member) => member.name === 'Anggota Registrasi QA')).toBe(true);
  // Another browser has neither the progress claim nor a login session.
  const other = await browser.newContext();
  const request = await other.request.get(new URL('/api/registration/status', page.url()).href);
  expect(await request.json()).toEqual({ registration: null });
  await other.close();
});

test('panduan iPhone berjalan berurutan tanpa klaim pemasangan otomatis', async ({ page }) => {
  await page.route('**/api/registration/status', (route) => route.fulfill({ json: { registration: {
    name: 'Anggota QA', email: 'qa@egiresources.com', division_id: 'it', verified: true, delivery: 'sent',
  } } }));
  await page.goto('/onboarding');
  await page.getByRole('radio', { name: /iPhone/ }).click();
  await page.getByRole('button', { name: 'Lanjutkan', exact: true }).click();
  await expect(page.getByRole('heading', { name: '2. Ketuk Bagikan' })).toBeVisible();
  await page.getByRole('button', { name: 'Lanjutkan', exact: true }).click();
  await expect(page.getByRole('heading', { name: '6. Ketuk Tambah' })).toBeVisible();
  await page.getByRole('button', { name: 'Sudah ditambahkan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Buka dari layar utama', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sebelumnya', exact: true }).click();
  await expect(page.getByRole('heading', { name: '6. Ketuk Tambah' })).toBeVisible();
});

test('tautan buka aplikasi tidak menyamarkan tab browser sebagai aplikasi terpasang', async ({ page }) => {
  await page.goto('/launch?source=onboarding');
  await expect(page.getByRole('heading', { name: 'Buka aplikasi terpasang' })).toBeVisible();
  await expect(page.getByText('Browser belum mengalihkan halaman ini ke aplikasi terpasang.')).toBeVisible();
  await expect(page).toHaveURL(/\/launch/);
});

test('worker tidak menyimpan respons akun/API dalam cache', async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.request.get('/api/registration/divisions');
  const paths = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (name) =>
    (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname)))).flat());
  expect(paths).toContain('/pwa/offline.html');
  expect(paths.every((path) => ['/pwa/offline.html', '/pwa/icon-512.png', '/pwa/icon-192.png', '/pwa/inter-latin.woff2'].includes(path))).toBe(true);
});

test('kegagalan sesi saat membuka standalone tidak dianggap keluar akun', async ({ page }) => {
  // Explicit UI simulation; real native desktop installation has a separate smoke script.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
  });
  await page.route('**/api/session', (route) => route.fulfill({ status: 503, json: { message: 'Offline test' } }));
  await page.goto('/launch');
  await expect(page.getByRole('heading', { name: 'Sesi tidak dapat diperiksa' })).toBeVisible();
  await expect(page).toHaveURL(/\/launch$/);
  await page.route('**/api/session', (route) => route.fulfill({ status: 401, json: { message: 'Signed out test' } }));
  await page.getByRole('button', { name: 'Coba lagi' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('navigasi offline menampilkan panduan lalu pulih ketika jaringan kembali', async ({ page, context }) => {
  await page.goto('/login');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  try {
    await page.goto('/timesheet?offline-check');
    await expect(page.getByRole('heading', { name: 'Anda sedang offline' })).toBeVisible();
  } finally { await context.setOffline(false); }
  await page.getByRole('link', { name: 'Coba lagi' }).click();
  await expect(page).toHaveURL(/\/launch$/);
  await expect(page.getByRole('heading', { name: 'Buka aplikasi terpasang' })).toBeVisible();
});
