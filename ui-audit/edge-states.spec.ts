import { expect, test } from '@playwright/test';
import { capture } from './capture';
import { mockScreen } from './fixture';
import { mutation } from './mutations';
import { division, user } from './data';

for (const state of ['loading', 'error']) test(`member-task__conflict-latest-${state}`, async ({ page }, info) => {
  await mockScreen(page, 'member');
  const write = await mutation(page, '/api/tasks/task-1');
  write.set(409, { message: 'Tugas sudah diperbarui.' });
  await page.goto('/timesheet/task-1/edit');
  await expect(page.getByRole('button', { name: 'Simpan perubahan' })).toBeVisible();
  await page.route('**/api/tasks/task-1', (route) => route.request().method() === 'GET'
    ? state === 'loading' ? undefined : route.fulfill({ status: 503, json: { message: 'Versi terbaru gagal.' } })
    : route.fallback());
  await page.getByRole('button', { name: 'Simpan perubahan' }).click();
  await expect(page.getByText('Tugas sudah diperbarui pengguna lain.', { exact: true })).toBeVisible();
  await expect(page.getByText(state === 'loading' ? 'Memuat data' : 'Versi terbaru belum dapat dimuat.', { exact: true })).toBeVisible();
  await capture(page, info, `member-task__conflict-latest-${state}`);
});

test('member-project-edit__pending-and-server-fields', async ({ page }, info) => {
  await mockScreen(page, 'member');
  const write = await mutation(page, '/api/projects/project-1');
  await page.goto('/projects/project-1/edit');
  write.set(400, { message: 'Periksa isian.', fields: { description: 'Deskripsi perlu diperiksa.' } });
  await page.getByRole('button', { name: 'Simpan perubahan', exact: true }).click();
  await expect(page.getByText('Deskripsi perlu diperiksa.', { exact: true })).toBeVisible();
  await capture(page, info, 'member-project-edit__server-fields');
  write.set(0);
  await page.getByRole('button', { name: 'Simpan perubahan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Menyimpan' })).toBeDisabled();
  await capture(page, info, 'member-project-edit__saving');
});

test('admin-user__division-validation-and-cancel-confirmation', async ({ page }, info) => {
  const fixture = await mockScreen(page, 'superadmin');
  fixture.overrides.set('/api/admin/users/member-1', { ...user, role: 'ceo', divisionId: null, divisionName: null });
  await page.goto('/admin/users/member-1');
  await page.getByRole('combobox', { name: /Peran/ }).selectOption('member');
  await page.getByRole('button', { name: 'Simpan perubahan', exact: true }).click();
  await expect(page.getByText('Pilih divisi pengguna.', { exact: true })).toBeVisible();
  await capture(page, info, 'admin-user__division-validation');
  await page.getByRole('combobox', { name: /Divisi/ }).selectOption(division.id);
  await page.getByRole('button', { name: 'Simpan perubahan', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Batal' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await capture(page, info, 'admin-user__cancelled-confirmation');
});

for (const role of ['superadmin', 'ceo'] as const) test(`${role}__archived-list`, async ({ page }, info) => {
  const fixture = await mockScreen(page, role);
  const prefix = role === 'ceo' ? '/ceo' : '/admin';
  fixture.overrides.set(`/api${prefix}/divisions`, [{ ...division, status: 'archived' }]);
  await page.goto(`${prefix}/divisions?status=archived`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(division.name, { exact: true }).first()).toBeVisible();
  await capture(page, info, `${role}__archived-list`);
});

for (const path of ['/ceo/divisions/division-1', '/ceo/projects/project-1', '/ceo/tasks/task-1']) {
  test(`ceo__forbidden-and-period-${path}`, async ({ page }, info) => {
    await mockScreen(page, 'ceo');
    await page.goto(path + '?month=2026-11&voiceFrom=2026-11-01&voiceTo=2026-11-30');
    await expect(page.getByRole('note')).toBeVisible();
    await capture(page, info, `ceo__period-${path.split('/').slice(-2).join('-')}`);
    await page.route((url) => url.pathname === '/api' + path, (route) => route.fulfill({ status: 403, json: { message: 'Akses ditolak.' } }));
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('Anda tidak memiliki akses');
    await capture(page, info, `ceo__forbidden-${path.split('/').slice(-2).join('-')}`);
  });
}
