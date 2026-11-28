import { expect, test } from '@playwright/test';
import { capture } from './capture';
import { mockScreen } from './fixture';
import { mutation } from './mutations';

test('verification__cross-browser-password-confirmation-loading-and-retry', async ({ page }, info) => {
  await mockScreen(page, 'public');
  const verify = await mutation(page, '/api/registration/verify');
  const link = '/register/verify#token=' + 'c'.repeat(64);
  verify.set(428, { message: 'Konfirmasi kata sandi pendaftaran untuk melanjutkan.', fields: { password: 'required' } });
  await page.goto(link);
  await page.reload();
  await page.getByRole('button', { name: 'Verifikasi email', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Konfirmasi pendaftaran', exact: true })).toBeVisible();
  await capture(page, info, 'verification__password-required');
  const input = page.getByLabel('Kata sandi pendaftaran', { exact: true });
  await input.fill('password-used-in-registration');
  await page.getByRole('button', { name: 'Tampilkan kata sandi', exact: true }).click();
  await expect(input).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Sembunyikan kata sandi', exact: true }).click();
  verify.set(403, { message: 'Kata sandi pendaftaran belum cocok. Periksa kembali isian Anda.' });
  await page.getByRole('button', { name: 'Verifikasi dan lanjutkan', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await capture(page, info, 'verification__password-error');
  verify.set(0);
  await page.getByRole('button', { name: 'Verifikasi dan lanjutkan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Memverifikasi', exact: true })).toBeDisabled();
  await expect(page.locator('.ui-spinner')).toBeVisible();
  await capture(page, info, 'verification__password-verifying');
  await verify.release(200, { email: 'anggota@egiresources.com', origin_device: 'mobile', same_browser: false, registration: null });
  await expect(page.getByRole('heading', { name: 'Email terverifikasi', exact: true })).toBeVisible();
  await expect(page.locator('.ui-spinner')).toHaveCount(0);
  await expect(page).toHaveURL(/\/register\/verify$/);
  await capture(page, info, 'verification__password-success');
});

test('session__animated-loader-before-role-page', async ({ page }, info) => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/session', async route => {
    await pending;
    await route.fulfill({ status: 401, json: {} });
  });
  await page.goto('/ceo');
  await expect(page.getByRole('status')).toHaveText('Memeriksa sesi');
  await expect(page.locator('.ui-spinner')).toBeVisible();
  await capture(page, info, 'session__animated-loading');
  release!();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('.ui-spinner')).toHaveCount(0);
});

 test('verification__malformed-success-does-not-confirm-or-consume-link', async ({ page }, info) => {
  await mockScreen(page, 'public');
  const verify = await mutation(page, '/api/registration/verify');
  verify.set(200, { requires_password: true });
  await page.goto('/register/verify#token=' + 'd'.repeat(64));
  await page.getByRole('button', { name: 'Verifikasi email', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Status verifikasi belum dapat dipastikan. Coba lagi.');
  await expect(page.getByRole('heading', { name: 'Email terverifikasi', exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/#token=/);
  await capture(page, info, 'verification__malformed-success');
});
