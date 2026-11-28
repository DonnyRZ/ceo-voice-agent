import { expect, test } from '@playwright/test';
import { capture } from './capture';
import { mockScreen } from './fixture';
import { mutation } from './mutations';
import { user } from './data';

for (const kind of ['account', 'invitation']) for (const status of kind === 'account' ? ['revoked'] : ['pending', 'failed', 'expired', 'revoked']) {
  test(`admin-user__${kind}-${status}`, async ({ page }, info) => {
    const fixture = await mockScreen(page, 'superadmin');
    fixture.overrides.set('/api/admin/users/member-1', { ...user, kind, status, name: kind === 'invitation' ? null : user.name });
    await page.goto('/admin/users/member-1');
    await expect(page.getByRole('heading', { name: kind === 'invitation' ? user.email : user.name, exact: true })).toBeVisible();
    await capture(page, info, `admin-user__${kind}-${status}`);
  });
}

for (const action of ['update', 'revoke']) for (const result of ['error', 'success']) test(`admin-user__${action}-${result}`, async ({ page }, info) => {
  const fixture = await mockScreen(page, 'superadmin');
  const write = await mutation(page, '/api/admin/users/member-1');
  await page.goto('/admin/users/member-1');
  if (action === 'update') {
    await page.getByRole('combobox', { name: /Peran/ }).selectOption('ceo');
    await page.getByRole('button', { name: 'Simpan perubahan', exact: true }).click();
  } else await page.getByRole('button', { name: 'Cabut akses', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await capture(page, info, `admin-user__${action}-${result}-dialog`);
  write.set(0);
  await dialog.getByRole('button', { name: action === 'update' ? 'Konfirmasi perubahan' : 'Cabut akses', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Memproses' })).toBeDisabled();
  await capture(page, info, `admin-user__${action}-${result}-busy`);
  const updated = { ...user, role: action === 'update' ? 'ceo' : 'member', status: action === 'revoke' ? 'revoked' : 'active' };
  if (result === 'success') fixture.overrides.set('/api/admin/users/member-1', updated);
  await write.release(result === 'success' ? 200 : 503, result === 'success' ? updated : { message: 'Akses belum berhasil diubah.' });
  await expect(dialog).toHaveCount(0);
  if (result === 'error') await expect(page.getByRole('alert')).toBeVisible();
  await capture(page, info, `admin-user__${action}-${result}-result`);
});

for (const action of ['retry', 'revoke']) test(`admin-invitation__${action}-states`, async ({ page }, info) => {
  const fixture = await mockScreen(page, 'superadmin');
  fixture.overrides.set('/api/admin/users/member-1', { ...user, kind: 'invitation', status: 'failed', name: null });
  const write = await mutation(page, action === 'retry' ? '/api/admin/invitations/member-1/retry' : '/api/admin/users/member-1');
  await page.goto('/admin/users/member-1');
  const start = async () => {
    await page.getByRole('button', { name: action === 'retry' ? 'Kirim ulang undangan' : 'Cabut akses', exact: true }).click();
    if (action === 'revoke') {
      await expect(page.getByRole('dialog').getByRole('heading')).toBeVisible();
      await capture(page, info, `admin-invitation__revoke-dialog`);
      await page.getByRole('dialog').getByRole('button', { name: 'Cabut akses', exact: true }).click();
    }
  };
  await start();
  await expect(page.getByText('Perubahan belum dapat disimpan.', { exact: true })).toBeVisible();
  await capture(page, info, `admin-invitation__${action}-error`);
  write.set(0);
  await start();
  await expect(page.getByRole('button', { name: action === 'retry' ? 'Mengirim' : 'Memproses' })).toBeDisabled();
  await capture(page, info, `admin-invitation__${action}-busy`);
  const updated = { ...user, kind: 'invitation', status: action === 'retry' ? 'pending' : 'revoked', name: null };
  fixture.overrides.set('/api/admin/users/member-1', updated);
  await write.release(200, updated);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await capture(page, info, `admin-invitation__${action}-success`);
});
