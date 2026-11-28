import { expect, test } from '@playwright/test';
import { capture } from './capture';
import { mockScreen } from './fixture';
import { audit, division, history, project, type Role } from './data';

for (const [role, path, endpoint] of [
  ['member', '/timesheet/task-1', '/api/tasks/task-1/history'],
  ['superadmin', '/admin/tasks/task-1', '/api/admin/tasks/task-1/history'],
  ['ceo', '/ceo/tasks/task-1', '/api/ceo/tasks/task-1/history'],
  ['member', '/projects/project-1', '/api/tasks'],
] as const) for (const state of ['loading', 'error', 'empty']) test(`${role}__secondary-${endpoint}-${state}`, async ({ page }, info) => {
  await mockScreen(page, role);
  await page.route((url) => url.pathname === endpoint, (route) => state === 'loading' ? undefined
    : route.fulfill({ status: state === 'error' ? 503 : 200, json: state === 'error' ? { message: 'Gangguan riwayat.' } : [] }));
  await page.goto(path);
  await expect(page.locator('h1')).toBeVisible();
  if (state !== 'loading') await expect.poll(async () => (await page.locator('main').innerText()).includes('Memuat ')).toBe(false);
  await capture(page, info, `${role}__secondary-${endpoint.split('/').slice(-2).join('-')}-${state}`);
});

for (const [role, path] of [['member', '/projects'], ['superadmin', '/admin/users'], ['superadmin', '/admin/divisions'], ['ceo', '/ceo/divisions']] as const) {
  test(`${role}__filtered-${path}`, async ({ page }, info) => {
    const fixture = await mockScreen(page, role);
    if (role !== 'member') fixture.overrides.set(path.replace(/^\//, '/api/'), []);
    await page.goto(path);
    await page.getByRole('searchbox').fill('Tidak Ada');
    await capture(page, info, `${role}__filtered-${path.split('/').pop()}`);
  });
}

for (const path of ['/admin/timesheets', '/admin/audit']) test(`admin__filtered-${path}`, async ({ page }, info) => {
  await mockScreen(page, 'superadmin');
  await page.route((url) => url.pathname === (path.endsWith('audit') ? '/api/admin/audit' : '/api/admin/tasks') && url.searchParams.size > 0,
    (route) => route.fulfill({ json: [] }));
  await page.goto(path + '?status=pending&divisionId=division-1');
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.getByText('Tidak ada hasil', { exact: true }).first()).toBeVisible();
  if (path.endsWith('audit') && info.project.name === 'mobile') {
    for (const selector of ['.admin-audit-filter-division', '.admin-audit-filter-period']) {
      const label = await page.locator(`${selector} .admin-filter-label`).boundingBox();
      const control = await page.locator(`${selector} select`).boundingBox();
      expect(label && control && label.y + label.height <= control.y,
        `${selector}: label must remain outside the 48px control`).toBe(true);
    }
  }
  await capture(page, info, `admin__filtered-${path.split('/').pop()}`);
  if (path.endsWith('audit') && await page.getByRole('button', { name: 'Filter lain', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Filter lain', exact: true }).click();
    await capture(page, info, 'admin-audit__extra-filters');
  }
});

for (const role of ['superadmin', 'ceo'] as Role[]) test(`${role}__archived-division`, async ({ page }, info) => {
  const fixture = await mockScreen(page, role);
  const prefix = role === 'ceo' ? '/ceo' : '/admin';
  fixture.overrides.set(`/api${prefix}/divisions/division-1`, { ...division, status: 'archived', projects: [project], tasks: [], members: [] });
  await page.goto(`${prefix}/divisions/division-1`);
  await expect(page.locator('h1')).toBeVisible();
  await capture(page, info, `${role}__archived-division`);
});

for (const mode of ['INSERT', 'DELETE']) test(`admin-audit__${mode}`, async ({ page }, info) => {
  const fixture = await mockScreen(page, 'superadmin');
  fixture.overrides.set('/api/admin/audit/audit-1', { ...audit, action: mode, before: mode === 'INSERT' ? null : audit.before, after: mode === 'DELETE' ? null : audit.after });
  await page.goto('/admin/audit/audit-1');
  await expect(page.getByText(mode === 'INSERT' ? 'Sesudah' : 'Sebelum', { exact: true }).first()).toBeVisible();
  await capture(page, info, `admin-audit__${mode}`);
});

for (const path of ['/ceo/divisions/division-1', '/ceo/projects/project-1', '/ceo/tasks/task-1']) test(`ceo__historical-source-${path}`, async ({ page }, info) => {
  const fixture = await mockScreen(page, 'ceo');
  fixture.overrides.set('/api/ceo/tasks/task-1/history', Array.from({ length: 50 }, (_, i) => ({ ...history[0], id: `history-${i}` })));
  await page.goto(path + '?voiceAsOf=2026-10-31');
  await expect(page.getByRole('note')).toBeVisible();
  await capture(page, info, `ceo__historical-${path.split('/').slice(-2).join('-')}`);
});
