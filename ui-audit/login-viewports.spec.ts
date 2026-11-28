import { expect, test } from '@playwright/test';
import { mockScreen } from './fixture';
import { mutation } from './mutations';
import { capture } from './capture';

for (const portal of ['login', 'superadmin']) test(`${portal}__short-and-wide-viewports`, async ({ page }, info) => {
  await mockScreen(page, 'public');
  const write = await mutation(page, portal === 'login' ? '/api/auth/sign-in/email' : '/api/superadmin/auth/sign-in/email');
  const sizes = info.project.name === 'desktop' ? [[1280, 720], [1920, 1080]] : [[320, 568], [360, 640], [430, 932]];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await page.goto(`/${portal}`);
    await expect(page.locator('h1')).toBeVisible();
    await capture(page, info, `${portal}__${width}x${height}`);
    await page.getByLabel('Email perusahaan', { exact: true }).fill('visual@example.test');
    await page.getByLabel('Kata sandi', { exact: true }).fill('visual-only-password');
    for (const code of [401, 429, 503]) {
      write.set(code, { message: 'Gangguan pengujian.' });
      await page.getByRole('button', { name: 'Masuk', exact: true }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await capture(page, info, `${portal}__${width}x${height}-error-${code}`);
    }
    write.set(0);
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sedang masuk…' })).toBeDisabled();
    await capture(page, info, `${portal}__${width}x${height}-submitting`);
    await write.release(401, { message: 'Kredensial tidak sesuai.' });
    await expect(page.getByRole('alert')).toBeVisible();
  }
});
