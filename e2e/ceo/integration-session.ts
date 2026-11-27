import { expect, type Browser, type Page } from '@playwright/test';
import { submitLogin } from '../session';

export async function signInCeo(page: Page) {
  const password = process.env.E2E_CEO_PASSWORD || process.env.E2E_PASSWORD || process.env.SEED_PASSWORD;
  if (!password) throw new Error('Siapkan kata sandi akun CEO pengujian di SEED_PASSWORD.');
  await page.goto('/login');
  await submitLogin(page, process.env.E2E_CEO_EMAIL || 'ceo@ruangkerja.test', password);
  await expect(page.getByRole('heading', { name: 'Dashboard CEO', exact: true })).toBeVisible();
}

export async function isolatedRolePage(browser: Browser, reference: Page) {
  const mobile = await reference.evaluate(() => matchMedia('(pointer: coarse)').matches);
  const context = await browser.newContext({ baseURL: new URL(reference.url()).origin,
    viewport: reference.viewportSize() ?? { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile });
  return { context, page: await context.newPage() };
}

export async function expectNoOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
}

export async function returnToCachedTask(page: Page, role: 'admin' | 'ceo') {
  await page.bringToFront();
  const taskUrl = page.url();
  const navigation = role === 'admin' ? 'Navigasi Superadmin' : 'Navigasi CEO';
  const label = role === 'admin' ? 'Timesheet' : 'Divisi';
  await page.getByRole('navigation', { name: navigation }).getByRole('link', { name: label, exact: true }).click();
  await expect(page).not.toHaveURL(taskUrl);
  await expect(page.getByRole('heading', {
    name: role === 'admin' ? 'Timesheet Semua Divisi' : 'Daftar Divisi', exact: true,
  })).toBeVisible();
  // Browser Back preserves the QueryClient, so this exercises a genuine warmed
  // cache without relying on headless cross-context visibility notifications.
  await page.goBack();
  await expect(page).toHaveURL(taskUrl);
}
