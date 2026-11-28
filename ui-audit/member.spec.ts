import { expect, test } from '@playwright/test';
import { capture } from './capture';
import { mockScreen } from './fixture';
import { mutation } from './mutations';
import { task, project } from './data';

for (const edit of [false, true]) test(`member-task-${edit ? 'edit' : 'new'}__form-states`, async ({ page }, info) => {
  await mockScreen(page, 'member');
  const write = await mutation(page, edit ? '/api/tasks/task-1' : '/api/tasks');
  const prefix = `member-task-${edit ? 'edit' : 'new'}`;
  await page.goto(edit ? '/timesheet/task-1/edit' : '/timesheet/new');
  const submit = () => page.getByRole('button', { name: /^(Simpan tugas|Simpan perubahan|Coba simpan lagi)$/ }).click();
  if (!edit) {
    await submit();
    await expect(page.locator('[aria-invalid=true]').first()).toBeVisible();
    await capture(page, info, `${prefix}__validation`);
    await page.locator('#ts-field-date').fill('2026-11-28');
    await page.locator('#ts-field-title').fill(task.title);
    await page.locator('#ts-field-projectId').selectOption(task.projectId);
    await page.locator('#ts-field-picId').selectOption(task.picId);
  }
  await submit();
  await expect(page.getByText('Perubahan belum tersimpan.', { exact: true })).toBeVisible();
  await capture(page, info, `${prefix}__save-error`);
  write.set(400, { message: 'Periksa input.', fields: { title: 'Judul perlu diperiksa.' } });
  await submit();
  await expect(page.getByText('Judul perlu diperiksa.', { exact: true })).toBeVisible();
  const fields = await page.locator('.ts-form input:not([type=radio]), .ts-form select, .ts-form textarea').evaluateAll((elements) =>
    elements.filter((element) => (element as HTMLElement).offsetParent !== null).map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { id: element.id, x, y, width, height };
    }));
  for (const [index, field] of fields.entries()) for (const other of fields.slice(index + 1)) {
    const overlap = Math.min(field.x + field.width, other.x + other.width) - Math.max(field.x, other.x) > 1
      && Math.min(field.y + field.height, other.y + other.height) - Math.max(field.y, other.y) > 1;
    expect(overlap, `${field.id} overlaps ${other.id}`).toBe(false);
  }
  await capture(page, info, `${prefix}__server-validation`);
  write.set(0);
  await submit();
  await expect(page.getByRole('button', { name: 'Menyimpan' })).toBeDisabled();
  await capture(page, info, `${prefix}__submitting`);
  await write.release(200, task);
  await expect(page.getByRole('heading', { name: 'Detail Tugas', exact: true })).toBeVisible();
  await capture(page, info, `${prefix}__saved-detail`);
});

test('member-task__conflict-and-history-states', async ({ page }, info) => {
  await mockScreen(page, 'member');
  const write = await mutation(page, '/api/tasks/task-1');
  write.set(409, { message: 'Tugas sudah diperbarui pengguna lain.' });
  await page.goto('/timesheet/task-1/edit');
  await page.getByRole('button', { name: 'Simpan perubahan', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await capture(page, info, 'member-task__conflict');
  await page.goto('/timesheet/task-1');
  await page.route('**/api/tasks/task-1/history', (route) => route.fulfill({ status: 503, json: { message: 'Riwayat gagal.' } }));
  await page.reload();
  await expect(page.getByText('Riwayat belum dapat dimuat.')).toBeVisible();
  await capture(page, info, 'member-task__history-error');
});

for (const edit of [false, true]) test(`member-project-${edit ? 'edit' : 'new'}__form-states`, async ({ page }, info) => {
  await mockScreen(page, 'member');
  const write = await mutation(page, edit ? '/api/projects/project-1' : '/api/projects');
  const prefix = `member-project-${edit ? 'edit' : 'new'}`;
  await page.goto(edit ? '/projects/project-1/edit' : '/projects/new');
  const submit = () => page.getByRole('button', { name: /^Simpan (proyek|perubahan)$/ }).click();
  await page.locator('#project-name').fill('');
  await submit();
  await expect(page.getByRole('alert')).toBeVisible();
  await capture(page, info, `${prefix}__validation`);
  await page.locator('#project-name').fill(project.name);
  await submit();
  await expect(page.getByRole('alert')).toBeVisible();
  await capture(page, info, `${prefix}__save-error`);
  if (edit) {
    write.set(409, { message: 'Versi berubah.' });
    await submit();
    await expect(page.getByRole('link', { name: 'Lihat versi terbaru' })).toBeVisible();
    await capture(page, info, `${prefix}__conflict`);
  } else {
    write.set(0);
    await submit();
    await expect(page.getByRole('button', { name: 'Menyimpan' })).toBeDisabled();
    await capture(page, info, `${prefix}__submitting`);
    await write.release(200, project);
    await expect(page.getByRole('heading', { name: 'Detail Proyek', exact: true })).toBeVisible();
    await capture(page, info, `${prefix}__saved-detail`);
  }
});
