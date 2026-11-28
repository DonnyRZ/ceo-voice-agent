import { expect, test } from '@playwright/test';
import { capture } from './capture';
import { screens } from './catalog';
import { mockScreen } from './fixture';
import { responseFor } from './data';

for (const screen of screens) for (const state of screen.states) {
  test(`${screen.id}__${state}`, async ({ page }, info) => {
    const fixture = await mockScreen(page, screen.role, state);
    if (screen.path.startsWith('/onboarding') && state === 'ready') {
      const value=responseFor('/api/registration/status','ready') as {registration: Record<string,unknown>};
      const step=new URL(screen.path,'http://localhost').searchParams.get('step')??'device';
      fixture.overrides.set('/api/registration/status',{registration:{...value.registration,completed:step==='done',step}});
    }
    if (screen.id === 'registration') fixture.overrides.set('/api/registration/status', { registration: null });
    await page.goto(screen.path);
    await expect(page.locator('h1')).toBeVisible();
    if (state === 'loading') await expect(page.locator('.ui-spinner, .install-spinner, .ceo-voice-spin').first()).toBeVisible();
    if (screen.id === 'onboarding-done') await expect(page.getByRole('heading',{name:'Panduan selesai'})).toBeVisible();
    if (state !== 'loading') await expect.poll(async () =>
      (await page.locator('main').innerText()).includes('Memuat '), { timeout: 5000 }).toBe(false);
    // Allow React query's fulfilled data to reach the committed browser layout.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await capture(page, info, `${screen.id}__${state}`);
    expect(fixture.unknown).toEqual([]);
    if (state === 'ready' && screen.role !== 'public') expect(await page.getByRole('alert').count()).toBe(0);
  });
}
