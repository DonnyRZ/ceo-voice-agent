import { expect, test, type Page } from '@playwright/test';
import { signInAdmin } from '../admin/session';
import { createProjectFixture, fixtureName, jakartaDate } from '../data';
import { signIn } from '../session';
import { expectNoOverflow, isolatedRolePage, returnToCachedTask, signInCeo } from './integration-session';

async function expectTask(page: Page, title: string, description: string, pic: string) {
  await expect(page.getByRole('heading', { name: 'Detail Tugas', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Informasi tugas', exact: true })
    .getByText(title, { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(description, { exact: true })).toBeVisible();
  await expect(page.getByText(pic, { exact: true }).first()).toBeVisible();
  await expectNoOverflow(page);
}

test('timesheet Anggota Divisi terhubung ke Superadmin dan seluruh halaman sumber CEO', async ({ browser, page }) => {
  test.setTimeout(80_000);
  await signIn(page);
  const project = await createProjectFixture(page);
  const members = await (await page.request.get('/api/members')).json() as { id: string; name: string }[];
  const doni = members.find(({ name }) => name === 'Doni')!;
  const hakim = members.find(({ name }) => name === 'Hakim')!;
  const title = fixtureName('Integrasi Lintas Peran');
  const description = 'Deskripsi awal tugas yang dimasukkan melalui formulir timesheet.';
  await page.goto('/timesheet');
  await page.getByRole('link', { name: 'Tambah tugas', exact: true }).click();
  await page.getByLabel('Tanggal', { exact: true }).fill(jakartaDate());
  await page.getByLabel('Judul tugas', { exact: true }).fill(title);
  await page.getByLabel('Deskripsi', { exact: true }).fill(description);
  await page.getByLabel('Proyek', { exact: true }).selectOption(project.id);
  await page.getByLabel('PIC', { exact: true }).selectOption(doni.id);
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('pending');
  const created = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/tasks');
  await page.getByRole('button', { name: 'Simpan tugas', exact: true }).click();
  const createResponse = await created;
  expect(createResponse.status(), await createResponse.text()).toBe(201);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const taskId = new URL(page.url()).pathname.split('/').at(-1)!;
  const admin = await isolatedRolePage(browser, page);
  const ceo = await isolatedRolePage(browser, page);

  try {
    await signInAdmin(admin.page);
    await admin.page.goto(`/admin/tasks/${taskId}`);
    await expectTask(admin.page, title, description, 'Doni');
    await signInCeo(ceo.page);
    await ceo.page.goto(`/ceo/tasks/${taskId}`);
    await expectTask(ceo.page, title, description, 'Doni');

    await page.bringToFront();
    await page.getByRole('link', { name: 'Edit Tugas', exact: true }).click();
    const latestTitle = `${title} Final`;
    const latestDescription = 'Pemeriksaan selesai, bukti dan perubahan PIC tersimpan dari timesheet.';
    await page.getByLabel('Judul tugas', { exact: true }).fill(latestTitle);
    await page.getByLabel('Deskripsi', { exact: true }).fill(latestDescription);
    await page.getByLabel('PIC', { exact: true }).selectOption(hakim.id);
    const status = page.getByRole('combobox', { name: 'Status', exact: true });
    if (await status.isVisible()) await status.selectOption('done');
    else await page.getByRole('radio', { name: 'Done', exact: true }).check();
    const saved = page.waitForResponse((response) => response.request().method() === 'PATCH'
      && new URL(response.url()).pathname === `/api/tasks/${taskId}`);
    await page.getByRole('button', { name: 'Simpan perubahan', exact: true }).click();
    const saveResponse = await saved;
    expect(saveResponse.status(), await saveResponse.text()).toBe(200);
    await expect(page.getByRole('heading', { name: latestTitle, exact: true })).toBeVisible();

    // Existing viewer sessions must refresh cached records when the user returns to them.
    await returnToCachedTask(admin.page, 'admin');
    await expectTask(admin.page, latestTitle, latestDescription, 'Hakim');
    await returnToCachedTask(ceo.page, 'ceo');
    await expectTask(ceo.page, latestTitle, latestDescription, 'Hakim');
    await expect(ceo.page.getByText('Done', { exact: true }).first()).toBeVisible();
    await ceo.page.getByRole('region', { name: 'Informasi tugas', exact: true })
      .getByRole('link', { name: project.name, exact: true }).click();
    await expect(ceo.page.getByRole('heading', { name: 'Detail Proyek', exact: true })).toBeVisible();
    await expect(ceo.page.getByRole('heading', { name: project.name, exact: true })).toBeVisible();
    await expect(ceo.page.getByRole('link', { name: latestTitle, exact: true })).toBeVisible();
    await expectNoOverflow(ceo.page);

    await ceo.page.goto('/ceo/divisions');
    await expect(ceo.page.getByRole('heading', { name: 'Daftar Divisi', exact: true })).toBeVisible();
    const { user } = await (await page.request.get('/api/session')).json() as { user: { divisionId: string } };
    await ceo.page.goto(`/ceo/divisions/${user.divisionId}`);
    await expect(ceo.page.getByRole('heading', { name: 'Detail Divisi', exact: true })).toBeVisible();
    await expect(ceo.page.getByRole('link', { name: project.name, exact: true })).toBeVisible();
    await expectNoOverflow(ceo.page);
    await ceo.page.goto('/ceo');
    await expect(ceo.page.getByRole('heading', { name: 'Dashboard CEO', exact: true })).toBeVisible();
    await expect(ceo.page.getByRole('link', { name: latestTitle, exact: true })).toBeVisible();
    await expectNoOverflow(ceo.page);
    expect((await ceo.page.request.get(`/api/ceo/tasks/${taskId}`)).ok()).toBe(true);
  } finally {
    await admin.context.close();
    await ceo.context.close();
  }
});

test('pengalihan login CEO dan pembatasan halaman antarperan berlaku di browser', async ({ page }) => {
  await signInCeo(page);
  for (const path of ['/timesheet', '/admin']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Dashboard CEO', exact: true })).toBeVisible();
  }
  expect((await page.request.get('/api/admin/dashboard')).status()).toBe(403);
  expect((await page.request.post('/api/tasks', { data: {} })).status()).toBe(403);
  await expectNoOverflow(page);
});
