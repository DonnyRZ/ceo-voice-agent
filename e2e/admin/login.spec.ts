import { expect, test } from '@playwright/test';
import { credentials, submitLogin } from '../session';
import { signInAdmin } from './session';

test('portal Superadmin responsif, redirect, dan siklus masuk/keluar', async ({ page }) => {
  await page.goto('/admin/users');
  await expect(page).toHaveURL(/\/superadmin$/);
  await expect(page.getByRole('heading', { name: 'Masuk Superadmin' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Kembali ke login pengguna' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => innerWidth),
  );
  await page.screenshot({ path: test.info().outputPath('superadmin-login.png'), fullPage: true });
  const password = process.env.E2E_ADMIN_PASSWORD || process.env.E2E_PASSWORD || process.env.SEED_PASSWORD;
  if (!password) throw new Error('Password fixture pengujian diperlukan.');
  const email = process.env.E2E_ADMIN_EMAIL || 'superadmin@ruangkerja.test';
  await page.goto('/login');
  await submitLogin(page, email, password);
  await expect(page.getByRole('alert')).toHaveText('Email atau kata sandi tidak sesuai.');
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/superadmin');
  const member = credentials();
  await submitLogin(page, member.email, member.password);
  await expect(page.getByRole('alert')).toHaveText('Email atau kata sandi tidak sesuai.');
  await signInAdmin(page);
  await page.goto('/admin/account');
  await page.getByRole('button', { name: 'Keluar', exact: true }).click();
  await expect(page).toHaveURL(/\/superadmin$/);
});
