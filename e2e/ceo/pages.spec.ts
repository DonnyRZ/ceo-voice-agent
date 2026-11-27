import { expect, test, type Page } from '@playwright/test';

const updatedAt = '2026-11-26T20:15:00.000Z';
const byStatus = { pending: 1, on_progress: 1, done: 1 };
const division = { id: 'division-it', name: 'IT', code: 'IT', description: 'Sistem dan layanan teknologi perusahaan.', status: 'active', updatedAt,
  memberCount: 2, projectCount: 1, taskCount: 3, byStatus, progress: 33 };
const task = { id: 'task-login', date: '2026-11-26', title: 'Validasi alur login', description: 'Uji akses dan pesan gagal.',
  projectId: 'project-mobile', projectName: 'Aplikasi A Mobile', picId: 'doni', picName: 'Doni', status: 'on_progress',
  version: 1, updatedAt, divisionId: division.id, divisionName: division.name };
const project = { id: task.projectId, name: task.projectName, description: 'Aplikasi internal perusahaan.', status: 'on_progress',
  version: 1, updatedAt, divisionId: division.id, divisionName: division.name, taskCount: 3, byStatus, progress: 33, picNames: ['Doni'] };

async function mockPages(page: Page) {
  const requests: URL[] = [];
  await page.route('**/api/session', (route) => route.fulfill({ json: { user: {
    id: 'ceo-ui', name: 'Dimas', email: 'dimas@ruangkerja.test', role: 'ceo', divisionId: null, divisionName: null,
  } } }));
  await page.route('**/api/ceo/**', (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const path = url.pathname;
    const data = path.endsWith('/dashboard') ? { counts: { divisions: 1, projects: 1, tasks: 3, members: 2 }, byStatus, divisions: [division], recentTasks: [task], updatedAt }
      : path.endsWith('/divisions') ? (url.searchParams.get('search') === 'Tidak Ada' ? [] : [division])
        : path.endsWith(`/divisions/${division.id}`) ? { ...division, members: [{ id: 'doni', name: 'Doni' }], projects: [project], tasks: [task] }
          : path.endsWith(`/projects/${project.id}`) ? { ...project, tasks: [task] }
            : path.endsWith('/history') ? [{ id: 'history-1', status: task.status, previousStatus: 'pending', changedAt: updatedAt, actorName: 'Doni' }]
              : task;
    return route.fulfill({ json: data });
  });
  return requests;
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
}

test('CEO menelusuri ringkasan, proyek dan sumber tugas melalui navigasi desktop/mobile', async ({ page }, testInfo) => {
  await mockPages(page);
  await page.goto('/ceo');
  await expect(page.getByRole('heading', { name: 'Dashboard CEO', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Buka Voice Agent', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: task.title, exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('01-dashboard.png') });
  await noOverflow(page);
  await page.getByRole('navigation', { name: 'Navigasi CEO' }).filter({ visible: true }).getByRole('link', { name: 'Divisi', exact: true }).click();
  await page.getByRole('link', { name: division.name, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Detail Divisi', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('04-detail-divisi.png') });
  await page.getByRole('link', { name: project.name, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Detail Proyek', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('05-detail-proyek.png') });
  await page.getByRole('link', { name: task.title, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Detail Tugas', exact: true })).toBeVisible();
  await expect(page.getByText(task.description, { exact: true })).toBeVisible();
  await expect(page.getByText('27 Nov 2026 · 03.15 WIB', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Riwayat Status', exact: true })).toBeVisible();
  await expect(page.getByText('Oleh Doni', { exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('06-detail-tugas.png') });
});

test('periode dashboard disaring dan tetap terbawa saat membuka divisi', async ({ page }) => {
  const requests = await mockPages(page);
  await page.goto('/ceo?month=2026-02');
  await expect(page.getByText('Februari 2026', { exact: true })).toBeVisible();
  await expect.poll(() => requests.some((url) => url.pathname.endsWith('/dashboard') && url.searchParams.get('to') === '2026-02-28')).toBe(true);
  await page.getByLabel('Periode tugas', { exact: true }).fill('2024-02');
  await expect.poll(() => requests.some((url) => url.searchParams.get('to') === '2024-02-29')).toBe(true);
  await page.getByRole('link', { name: /Lihat semua divisi/ }).click();
  await expect(page).toHaveURL(/month=2024-02/);
  await expect(page.getByLabel('Status divisi', { exact: true })).toHaveValue('all');
  await expect.poll(() => requests.some((url) => url.pathname.endsWith('/divisions') && !url.searchParams.has('status'))).toBe(true);
  await page.getByRole('link', { name: division.name, exact: true }).click();
  await expect(page.getByText('Februari 2024', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Semua periode', exact: true }).click();
  await expect(page).not.toHaveURL(/month=/);
});

test('pencarian kosong tidak ditampilkan sebagai kegagalan layanan', async ({ page }, testInfo) => {
  await mockPages(page);
  await page.goto('/ceo/divisions');
  await page.getByLabel('Cari divisi', { exact: true }).fill('Tidak Ada');
  await expect(page.getByRole('status')).toHaveText('Tidak ada divisi yang sesuai dengan pencarian.');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('divisions-empty.png') });
  await noOverflow(page);
});

test('tugas tidak ditemukan dan layanan gagal punya penanganan berbeda', async ({ page }) => {
  await mockPages(page);
  await page.route('**/api/ceo/tasks/missing', (route) => route.fulfill({ status: 404, json: { message: 'Tidak ditemukan.' } }));
  await page.goto('/ceo/tasks/missing');
  await expect(page.getByRole('alert')).toContainText('Tugas tidak ditemukan');
  await expect(page.getByRole('button', { name: 'Coba lagi', exact: true })).toHaveCount(0);
  await page.route('**/api/ceo/dashboard?*', (route) => route.fulfill({ status: 503, json: { message: 'Gangguan sementara.' } }));
  await page.goto('/ceo');
  await expect(page.getByRole('alert')).toContainText('Ringkasan pekerjaan belum dapat dimuat.');
  await expect(page.getByRole('button', { name: 'Coba lagi', exact: true })).toBeVisible();
});

test('sumber historis menandai batas waktu suara dan tetap memperlihatkan fakta terkini', async ({ page }) => {
  await mockPages(page);
  for (const path of [`/ceo/divisions/${division.id}`, `/ceo/projects/${project.id}`, `/ceo/tasks/${task.id}`]) {
    await page.goto(`${path}?voiceAsOf=2026-10-31`);
    const note = page.getByRole('note', { name: 'Konteks sumber jawaban suara', exact: true });
    await expect(note).toContainText('status per 31 Okt 2026');
    await expect(note).toContainText('Detail di bawah menampilkan catatan dan status terkini');
    await noOverflow(page);
  }
  await expect(page.getByText('On Progress', { exact: true }).first()).toBeVisible();
  await page.getByRole('link', { name: project.name, exact: true }).last().click();
  await expect(page).toHaveURL(/voiceAsOf=2026-10-31/);
  await expect(page.getByRole('note')).toContainText('status per 31 Okt 2026');
});

test('sumber periode mempertahankan bulan yang didukung dan mengabaikan tanggal tidak sah', async ({ page }) => {
  const requests = await mockPages(page);
  await page.goto(`/ceo/projects/${project.id}?month=2026-02&voiceFrom=2026-02-01&voiceTo=2026-02-28`);
  await expect(page.getByRole('note')).toContainText('periode 1 Feb 2026 hingga 28 Feb 2026');
  await expect(page.getByText('Februari 2026', { exact: true })).toBeVisible();
  await expect.poll(() => requests.some((url) => url.pathname.endsWith(`/projects/${project.id}`) && url.searchParams.get('from') === '2026-02-01' && url.searchParams.get('to') === '2026-02-28')).toBe(true);
  await page.getByRole('link', { name: task.title, exact: true }).click();
  await expect(page).toHaveURL(/month=2026-02/);
  await expect(page.getByRole('note')).toContainText('periode 1 Feb 2026 hingga 28 Feb 2026');
  await page.goto(`/ceo/tasks/${task.id}?voiceAsOf=2026-02-30&voiceFrom=2026-03-01&voiceTo=2026-02-01`);
  await expect(page.getByRole('heading', { name: task.title, exact: true })).toBeVisible();
  await expect(page.getByRole('note')).toHaveCount(0);
});
