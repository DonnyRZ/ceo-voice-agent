import { expect, test } from '@playwright/test';
import { capture } from './capture';
import { mockScreen } from './fixture';

for (const state of ['ready', 'loading', 'error', 'empty'] as const) {
  test('admin-audit__filter-icons-clear-text-' + state, async ({ page }, info) => {
    await mockScreen(page, 'superadmin', state);
    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { name: 'Audit Log', exact: true })).toBeVisible();
    const fields = page.locator('.admin-audit-filters select');
    await expect(fields.first()).toBeVisible();
    for (const field of await fields.all()) {
      const spacing = await field.evaluate((select) => {
        const icon = select.parentElement?.querySelector('.admin-filter-control-icon');
        if (!icon || !icon.getBoundingClientRect().width) return null;
        return {
          textStart: select.getBoundingClientRect().left + parseFloat(getComputedStyle(select).paddingLeft),
          iconEnd: icon.getBoundingClientRect().right,
        };
      });
      if (spacing) expect(spacing.textStart).toBeGreaterThanOrEqual(spacing.iconEnd + 8);
    }
    await capture(page, info, 'admin-audit__filter-clearance-' + state);
  });
}
