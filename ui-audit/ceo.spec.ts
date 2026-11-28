import { expect, test } from '@playwright/test';
import { capture } from './capture';
import { mockScreen } from './fixture';
import { mutation } from './mutations';

test('ceo-security__validation-server-pending-success', async ({ page }, info) => {
  await mockScreen(page, 'ceo');
  const write = await mutation(page, '/api/account/password');
  await page.goto('/ceo/account/security');
  await page.getByLabel('Kata sandi saat ini', { exact: true }).fill('visual-password-old');
  await page.getByLabel('Kata sandi baru', { exact: true }).fill('visual-password-new');
  await page.getByLabel('Konfirmasi kata sandi baru', { exact: true }).fill('not-matching');
  await page.getByRole('button', { name: 'Simpan kata sandi' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await capture(page, info, 'ceo-security__mismatch');
  await page.getByLabel('Kata sandi baru', { exact: true }).fill('visual-password-old');
  await page.getByLabel('Konfirmasi kata sandi baru', { exact: true }).fill('visual-password-old');
  await page.getByRole('button', { name: 'Simpan kata sandi' }).click();
  await expect(page.getByRole('alert')).toHaveText('Gunakan kata sandi baru yang berbeda.');
  await capture(page, info, 'ceo-security__same-password');
  await page.getByLabel('Kata sandi baru', { exact: true }).fill('visual-password-new');
  await page.getByLabel('Konfirmasi kata sandi baru', { exact: true }).fill('visual-password-new');
  await page.getByRole('button', { name: 'Simpan kata sandi' }).click();
  await expect(page.getByRole('alert')).toHaveText('Perubahan belum dapat disimpan.');
  await capture(page, info, 'ceo-security__server-error');
  write.set(0);
  await page.getByRole('button', { name: 'Simpan kata sandi' }).click();
  await expect(page.getByRole('button', { name: 'Menyimpan…' })).toBeDisabled();
  await capture(page, info, 'ceo-security__saving');
  await write.release(200, { success: true });
  await expect(page.getByText('Kata sandi berhasil diperbarui. Sesi lain telah dikeluarkan.')).toBeVisible();
  await capture(page, info, 'ceo-security__saved');
});

for (const failed of [false, true]) test(`ceo-settings__${failed ? 'storage-error' : 'off-on'}`, async ({ page }, info) => {
  await mockScreen(page, 'ceo');
  if (failed) await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Storage unavailable'); }; });
  await page.goto('/ceo/settings');
  await page.getByRole('switch', { name: 'Putar jawaban suara' }).click();
  await expect(page.getByRole(failed ? 'alert' : 'status')).toBeVisible();
  await capture(page, info, failed ? 'ceo-settings__storage-error' : 'ceo-settings__off');
  if (!failed) {
    await page.getByRole('switch', { name: 'Putar jawaban suara' }).click();
    await capture(page, info, 'ceo-settings__on');
  }
});
