import { expect, test } from '@playwright/test';
import { mockScreen } from './fixture';
import { capture } from './capture';
import { identity, responseFor, type Role } from './data';

const name = ('Pengembangan Operasional Teknologi Perusahaan ').repeat(4).slice(0, 120);
const description = ('Penjelasan pekerjaan dan koordinasi lintas unit untuk memastikan pembaruan tercatat dengan lengkap. ').repeat(24).slice(0, 2000);
function longContent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(longContent);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    ['name', 'title', 'projectName', 'divisionName', 'picName', 'actorName'].includes(key) && typeof entry === 'string' ? name
      : key === 'description' ? description : longContent(entry),
  ]));
  return value;
}
const pages: [Role, string][] = [
  ['member', '/'], ['superadmin', '/admin'], ['ceo', '/ceo'],
  ['member', '/timesheet'],
  ['member', '/account'], ['superadmin', '/admin/account'], ['ceo', '/ceo/account'],
  ['member', '/timesheet/task-1'], ['superadmin', '/admin/tasks/task-1'], ['ceo', '/ceo/tasks/task-1'],
  ['member', '/projects/project-1'], ['ceo', '/ceo/projects/project-1'],
  ['superadmin', '/admin/users'], ['superadmin', '/admin/users/member-1'],
  ['superadmin', '/admin/divisions'], ['ceo', '/ceo/divisions'], ['superadmin', '/admin/divisions/division-1'],
];
for (const [role, path] of pages) test(`${role}__long-content-${path}`, async ({ page }, info) => {
  const fixture = await mockScreen(page, role);
  fixture.overrides.set('/api/session', longContent(identity(role)));
  await page.route('**/api/**', async (route) => {
    const endpoint = new URL(route.request().url()).pathname;
    if (endpoint === '/api/session') return route.fallback();
    return route.fulfill({ json: longContent(responseFor(endpoint, 'ready')) });
  });
  await page.goto(path);
  await expect(page.locator('h1')).toBeVisible();
  await expect.poll(async () => (await page.locator('main').innerText()).includes('Memuat ')).toBe(false);
  if (path === '/projects/project-1' && info.project.name === 'desktop') {
    for (const selector of ['.project-hero h2', '.project-hero-description']) {
      const column = await page.locator(selector).boundingBox();
      expect(column?.width, `${selector}: readable long-content column`).toBeGreaterThanOrEqual(160);
    }
  }
  if (path === '/timesheet' && info.project.name === 'mobile') {
    const division = await page.locator('.ts-list-mobile-division').boundingBox();
    const role = await page.locator('.ts-list-mobile-role').boundingBox();
    expect(division && role && division.y + division.height <= role.y + 1,
      'Division name and role must not overlap').toBe(true);
  }
  await capture(page, info, `${role}__long-${path.replaceAll('/', '-') || 'dashboard'}`);
});
