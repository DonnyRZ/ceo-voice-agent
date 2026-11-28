import type { Page, Route } from '@playwright/test';

export async function mutation(page: Page, path: string) {
  let result: unknown = { message: 'Perubahan belum dapat disimpan.' };
  let status = 503;
  const pending: Route[] = [];
  await page.route((url) => url.pathname === path, async (route) => {
    if (route.request().method() === 'GET') return route.fallback();
    if (status === 0) { pending.push(route); return; }
    await route.fulfill({ status, json: result });
  });
  return {
    set(code: number, value?: unknown) { status = code; if (value !== undefined) result = value; },
    async release(code: number, value: unknown) {
      status = code; result = value;
      await Promise.all(pending.splice(0).map((route) => route.fulfill({ status: code, json: value })));
    },
  };
}
