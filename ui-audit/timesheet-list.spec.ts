import { expect, test } from '@playwright/test';
import { mockScreen } from './fixture';
import { capture } from './capture';

test('member-timesheet__filtered-no-results', async ({ page }, info) => {
  await mockScreen(page, 'member');
  await page.route((url) => url.pathname === '/api/tasks' && url.searchParams.size > 0,
    (route) => route.fulfill({ json: [] }));
  await page.goto('/timesheet');
  await expect(page.getByRole('link', { name: 'Validasi akses dan sinkronisasi laporan lapangan', exact: true }).first()).toBeVisible();
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('pending');
  await expect(page.locator('.ts-list--no-results')).toBeVisible();
  await capture(page, info, 'member-timesheet__filtered-no-results');
  await page.getByRole('button', { name: 'Hapus filter', exact: true }).click();
  await expect(page.locator('.ts-list--no-results')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Validasi akses dan sinkronisasi laporan lapangan', exact: true }).first()).toBeVisible();
  await capture(page, info, 'member-timesheet__filter-cleared');
});
