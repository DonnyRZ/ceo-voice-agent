import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { registrationEmail } from '../backend/modules/registration/email-template';
import { capture } from './capture';
import { mockScreen } from './fixture';
import { mutation } from './mutations';

const base = { name: 'Anggota QA', email: 'anggota@egiresources.com', division_id: 'division-1',
  verified: false, delivery: 'not_sent', retry_after_seconds: 0, sends_remaining: 5 };

for (const origin of ['desktop', 'mobile'] as const) {
  test('verification-flow__' + origin + '-origin-states', async ({ page }, info) => {
    const fixture = await mockScreen(page, 'public');
    const registration = { ...base, origin_device: origin };
    for (const state of ['not_sent', 'sending', 'sent', 'failed', 'verified', 'limit'] as const) {
      fixture.overrides.set('/api/registration/status', { registration: { ...registration,
        verified: state === 'verified', delivery: state === 'not_sent' ? 'not_sent' : state === 'sending' ? 'pending' : state === 'failed' ? 'failed' : 'sent',
        retry_after_seconds: ['sending', 'sent'].includes(state) ? 60 : 0, sends_remaining: state === 'limit' ? 0 : 4 } });
      await page.goto('/register/check-email');
      const heading = state === 'verified' ? origin === 'mobile' ? 'Email terverifikasi' : 'Registrasi selesai'
        : ['not_sent', 'sending'].includes(state) ? 'Verifikasi email' : state === 'failed' ? 'Email belum terkirim' : 'Periksa email Anda';
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await capture(page, info, 'verification-flow__' + origin + '-' + state);
      if (state === 'sending') await expect(page.getByRole('button', { name: 'Mengirim…', exact: true })).toBeDisabled();
      if (origin === 'mobile' && state !== 'verified') await expect(page.getByRole('button', { name: 'Lanjutkan', exact: true })).toBeDisabled();
      if (state === 'verified') await expect(page.getByRole('link', { name: origin === 'mobile' ? 'Lanjutkan' : 'Masuk ke Ruang Kerja', exact: true })).toBeVisible();
    }
    fixture.overrides.set('/api/registration/status', { registration });
    await page.goto('/onboarding?step=android-install');
    await expect(page).toHaveURL(/\/register\/check-email$/);
    await expect(page.getByRole('button', { name: 'Pasang aplikasi', exact: true })).toHaveCount(0);
  });
}

test('verification-flow__email-destination-and-owner-resume', async ({ page }, info) => {
  const fixture = await mockScreen(page, 'public');
  const confirm = await mutation(page, '/api/registration/verify');
  for (const origin of ['desktop', 'mobile', null] as const) {
    confirm.set(200, { email: base.email, origin_device: origin, same_browser: false, registration: null });
    await page.goto('/register/verify#token=' + 'd'.repeat(64));
    await page.getByRole('button', { name: 'Verifikasi email', exact: true }).click();
    await expect(page.getByRole('heading', { name: origin === 'desktop' ? 'Registrasi selesai' : 'Email terverifikasi', exact: true })).toBeVisible();
    await capture(page, info, 'verification-flow__external-' + (origin ?? 'unrecorded'));
    if (origin === 'mobile') await expect(page.getByRole('link', { name: 'Masuk ke Ruang Kerja', exact: true })).toHaveCount(0);
  }
  for (const origin of ['mobile', 'desktop'] as const) {
    fixture.overrides.set('/api/registration/status', { registration: { ...base, origin_device: origin, verified: true, delivery: 'sent' } });
    confirm.set(200, { email: base.email, origin_device: origin, same_browser: true,
      registration: { ...base, origin_device: origin, verified: true, delivery: 'sent' } });
    await page.goto('/register/verify#token=' + 'e'.repeat(64));
    await page.getByRole('button', { name: 'Verifikasi email', exact: true }).click();
    await expect(page).toHaveURL(/\/register\/check-email$/);
    await expect(page.getByRole('heading', { name: origin === 'desktop' ? 'Registrasi selesai' : 'Email terverifikasi', exact: true })).toBeVisible();
    await capture(page, info, 'verification-flow__same-browser-' + origin);
  }
});

test('verification-flow__invalid-link-and-small-viewport', async ({ page }, info) => {
  const fixture = await mockScreen(page, 'public');
  const confirm = await mutation(page, '/api/registration/verify');
  confirm.set(400, { message: 'Tautan tidak berlaku.' });
  await page.goto('/register/verify#token=' + 'f'.repeat(64));
  await page.getByRole('button', { name: 'Verifikasi email', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tautan tidak berlaku' })).toBeVisible();
  await capture(page, info, 'verification-flow__invalid-link');
  fixture.overrides.set('/api/registration/status', { registration: { ...base, origin_device: 'mobile' } });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/register/check-email');
  await expect(page.getByRole('heading', { name: 'Verifikasi email', exact: true })).toBeVisible();
  await capture(page, info, 'verification-flow__small-mobile');
  await expect(page.getByRole('button', { name: 'Lanjutkan', exact: true })).toBeDisabled();
});

test('verification-flow__rendered-email-button', async ({ page }, info) => {
  const image = (await readFile('backend/modules/mail/assets/brand.png')).toString('base64');
  const html = registrationEmail('https://example.test/register/verify#token=' + 'a'.repeat(64))
    .replace('cid:ruang-kerja-brand', 'data:image/png;base64,' + image);
  await page.setContent(html);
  await expect(page.getByRole('link', { name: 'Verifikasi email', exact: true })).toHaveAttribute('href', /https:\/\/example.test\/register\/verify#token=/);
  await capture(page, info, 'verification-flow__email-body');
});
