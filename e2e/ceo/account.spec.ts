import { expect, test, type Page } from '@playwright/test';

async function mockAccount(page: Page, id = 'ceo-account-qa') {
  let signedIn = true;
  const passwords: unknown[] = [];
  await page.route('**/api/session', (route) => route.fulfill(signedIn ? { json: { user: {
    id, name: 'Dimas Kurnia', email: 'dimas@ruangkerja.test', role: 'ceo', divisionId: null, divisionName: null,
  } } } : { status: 401, json: { message: 'Sesi berakhir.' } }));
  await page.route('**/api/auth/sign-out', (route) => {
    signedIn = false;
    return route.fulfill({ json: { success: true } });
  });
  await page.route('**/api/account/password', (route) => {
    passwords.push(route.request().postDataJSON());
    return route.fulfill({ json: { success: true } });
  });
  return passwords;
}

test('akun CEO menampilkan identitas sesi, menu keamanan, pengaturan dan keluar', async ({ page }, testInfo) => {
  await mockAccount(page);
  await page.goto('/ceo/account');
  await expect(page.getByRole('heading', { name: 'Akun', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dimas Kurnia', exact: true })).toBeVisible();
  await expect(page.getByText('dimas@ruangkerja.test', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('account.png'), fullPage: true });
  await page.getByRole('link', { name: 'Keamanan akun', exact: true }).click();
  await expect(page).toHaveURL(/\/ceo\/account\/security$/);
  await page.getByRole('link', { name: 'Akun', exact: true }).first().click();
  await page.getByRole('link', { name: 'Pengaturan', exact: true }).click();
  await expect(page).toHaveURL(/\/ceo\/settings$/);
  await page.getByRole('link', { name: 'Akun', exact: true }).first().click();
  await page.getByRole('button', { name: 'Keluar', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('preferensi suara tersimpan setelah muat ulang dan terpisah per akun', async ({ page }, testInfo) => {
  await mockAccount(page);
  await page.goto('/ceo/settings');
  const playback = page.getByRole('switch', { name: 'Putar jawaban suara', exact: true });
  await expect(playback).toBeChecked();
  await playback.click();
  await expect(playback).not.toBeChecked();
  await page.reload();
  await expect(playback).not.toBeChecked();
  await expect(page.getByText('Bahasa Indonesia', { exact: true })).toBeVisible();
  await mockAccount(page, 'ceo-another-account');
  await page.reload();
  await expect(playback).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('settings.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
});

test('keamanan akun memvalidasi konfirmasi dan mengirim kata sandi hanya ke endpoint akun', async ({ page }) => {
  const requests = await mockAccount(page);
  await page.goto('/ceo/account/security');
  await page.getByLabel('Kata sandi saat ini', { exact: true }).fill('old-password-qa');
  await page.getByLabel('Kata sandi baru', { exact: true }).fill('new-password-qa');
  await page.getByLabel('Konfirmasi kata sandi baru', { exact: true }).fill('different-password');
  await page.getByRole('button', { name: 'Simpan kata sandi', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Konfirmasi kata sandi belum sesuai.');
  expect(requests).toHaveLength(0);
  await page.getByLabel('Konfirmasi kata sandi baru', { exact: true }).fill('new-password-qa');
  await page.getByRole('button', { name: 'Simpan kata sandi', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Kata sandi berhasil diperbarui');
  expect(requests).toEqual([{ currentPassword: 'old-password-qa', newPassword: 'new-password-qa' }]);
  await expect(page.getByLabel('Kata sandi saat ini', { exact: true })).toBeEmpty();
  await expect(page.getByLabel('Kata sandi baru', { exact: true })).toBeEmpty();
});

test('gagal penyimpanan preferensi tidak mengubah sakelar suara', async ({ page }) => {
  await mockAccount(page);
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
  });
  await page.goto('/ceo/settings');
  const playback = page.getByRole('switch', { name: 'Putar jawaban suara', exact: true });
  await playback.click();
  await expect(playback).toBeChecked();
  await expect(page.getByRole('alert')).toContainText('Pengaturan belum tersimpan.');
});

test('gagal keluar mempertahankan halaman akun dan menyediakan percobaan ulang', async ({ page }) => {
  await mockAccount(page);
  await page.route('**/api/auth/sign-out', (route) => route.fulfill({ status: 503, json: { message: 'Gangguan uji.' } }));
  await page.goto('/ceo/account');
  await page.getByRole('button', { name: 'Keluar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Belum dapat keluar.');
  await expect(page.getByRole('button', { name: 'Keluar', exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/\/ceo\/account$/);
});
