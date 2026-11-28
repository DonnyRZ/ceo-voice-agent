import { expect, test } from '@playwright/test';
import { capture } from './capture';
import { mockScreen } from './fixture';
import { mutation } from './mutations';
import type { Role } from './data';

for (const portal of ['login', 'superadmin']) test(`${portal}__interaction-states`, async ({ page }, info) => {
  await mockScreen(page, 'public');
  const write = await mutation(page, portal === 'login' ? '/api/auth/sign-in/email' : '/api/superadmin/auth/sign-in/email');
  await page.goto(`/${portal}`);
  await page.getByLabel('Email perusahaan', { exact: true }).fill('visual@example.test');
  await page.getByLabel('Kata sandi', { exact: true }).fill('visual-only-password');
  await page.getByRole('button', { name: 'Tampilkan kata sandi' }).click();
  await capture(page, info, `${portal}__password-visible`);
  for (const code of [401, 429, 503]) {
    write.set(code, { message: 'Gangguan pengujian.' });
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await capture(page, info, `${portal}__error-${code}`);
  }
  write.set(0);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sedang masuk…' })).toBeDisabled();
  await capture(page, info, `${portal}__submitting`);
});

test('activation__interaction-states', async ({ page }, info) => {
  await mockScreen(page, 'public');
  const write = await mutation(page, '/api/activate');
  await page.goto('/activate#token=visual-fixture');
  await page.getByLabel('Nama lengkap').fill('Pengguna Visual');
  await page.getByLabel('Kata sandi', { exact: true }).fill('visual-password-1');
  await page.getByLabel('Konfirmasi kata sandi', { exact: true }).fill('different-password');
  await page.getByRole('button', { name: 'Aktifkan akun' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await capture(page, info, 'activation__validation');
  await page.getByLabel('Konfirmasi kata sandi', { exact: true }).fill('visual-password-1');
  await page.getByRole('button', { name: 'Aktifkan akun' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await capture(page, info, 'activation__server-error');
  write.set(0);
  await page.getByRole('button', { name: 'Aktifkan akun' }).click();
  await expect(page.getByRole('button', { name: 'Mengaktifkan…' })).toBeDisabled();
  await capture(page, info, 'activation__submitting');
  await write.release(200, { success: true });
  await expect(page.getByRole('heading', { name: 'Akun sudah aktif' })).toBeVisible();
  await capture(page, info, 'activation__success');
});

for (const [role, path] of [['member', '/account'], ['superadmin', '/admin/account'], ['ceo', '/ceo/account']] as const) {
  test(`${role}__logout-states`, async ({ page }, info) => {
    await mockScreen(page, role);
    const write = await mutation(page, '/api/auth/sign-out');
    await page.goto(path);
    await page.getByRole('button', { name: 'Keluar', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await capture(page, info, `${role}__logout-error`);
    write.set(0);
    await page.getByRole('button', { name: 'Keluar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sedang keluar…' })).toBeDisabled();
    await capture(page, info, `${role}__logging-out`);
  });
}

for (const role of ['member', 'superadmin', 'ceo'] as Role[]) for (const state of ['loading', 'error']) {
  test(`${role}__session-${state}`, async ({ page }, info) => {
    await mockScreen(page, role);
    await page.route('**/api/session', (route) => state === 'loading' ? undefined : route.fulfill({ status: 503, json: { message: 'Gangguan sesi.' } }));
    await page.goto(role === 'member' ? '/' : role === 'superadmin' ? '/admin' : '/ceo');
    await expect(page.getByText(state === 'loading' ? 'Memeriksa sesi…' : 'Sesi tidak dapat diperiksa.', { exact: true })).toBeVisible();
    await capture(page, info, `${role}__session-${state}`);
  });
}
