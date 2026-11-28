import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { requireLocalSmtp } from './admin/mailpit';

test('verifikasi pada browser asal mempertahankan langkah sesudah reload dan menolak bypass pemasangan', async ({ page }, info) => {
  requireLocalSmtp();
  const email = 'registration-owner-' + randomUUID().slice(0, 12) + '@egiresources.com';
  const originDevice = info.project.name === 'mobile' ? 'mobile' : 'desktop';
  const options = await (await page.request.get('/api/registration/divisions')).json();
  const saved = await page.request.post('/api/registration', { data: {
    name: 'Anggota Browser Asal', email, divisionId: options.divisions[0].id,
    password: 'Browser-owner-' + randomUUID(), originDevice,
  } });
  expect(saved.status()).toBe(201);
  expect((await saved.json()).registration.delivery).toBe('not_sent');
  await page.goto('/onboarding?step=android-install');
  await expect(page).toHaveURL(/\/register\/check-email$/);
  await page.getByRole('button', { name: 'Kirim email verifikasi', exact: true }).click();
  const mailbox = new URL(process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:8025');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(mailbox.hostname)) throw new Error('Local Mailpit is required.');
  let messageId: string | undefined;
  await expect.poll(async () => {
    const data = await (await fetch(new URL('/api/v1/search?' + new URLSearchParams({ query: 'to:' + email }), mailbox))).json();
    messageId = data.messages?.[0]?.ID;
    return Boolean(messageId);
  }).toBe(true);
  const message = await (await fetch(new URL('/api/v1/message/' + messageId, mailbox))).json();
  const link = (message.Text.match(/https?:\/\/[^\s<>]+/g) ?? []).map((value: string) => new URL(value))
    .find((url: URL) => url.pathname === '/register/verify');
  expect(link.origin).toBe(new URL(page.url()).origin);
  const confirmation = await page.context().newPage();
  await confirmation.goto(link.href);
  await confirmation.getByRole('button', { name: 'Verifikasi email', exact: true }).click();
  await expect(confirmation).toHaveURL(/\/register\/check-email$/);
  const heading = originDevice === 'mobile' ? 'Email terverifikasi' : 'Registrasi selesai';
  await expect(confirmation.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  await confirmation.reload();
  await expect(confirmation.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  expect((await confirmation.request.get('/api/session')).status()).toBe(401);
  if (originDevice === 'mobile') {
    await confirmation.getByRole('link', { name: 'Lanjutkan', exact: true }).click();
    await expect(confirmation.getByRole('heading', { name: 'Pilih perangkat Anda', exact: true })).toBeVisible();
    await confirmation.getByRole('link', { name: 'Sebelumnya', exact: true }).click();
    await expect(confirmation.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  } else {
    await confirmation.goto('/onboarding');
    await expect(confirmation).toHaveURL(/\/register\/check-email$/);
    await expect(confirmation.getByRole('link', { name: 'Masuk ke Ruang Kerja', exact: true })).toBeVisible();
  }
});
