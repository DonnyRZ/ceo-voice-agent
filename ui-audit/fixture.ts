import type { Page, Route } from '@playwright/test';
import { identity, responseFor, type Role, type State } from './data';

export async function mockScreen(page: Page, role: Role, state: State = 'ready') {
  const unknown: string[] = [];
  const pending: Route[] = [];
  const overrides = new Map<string, unknown>();
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ status: role === 'public' ? 401 : 200, json: { user: overrides.get(path) ?? identity(role) } });
    if (['/api/registration/progress','/api/registration/complete'].includes(path)) {
      const previous = (overrides.get('/api/registration/status') ?? responseFor('/api/registration/status','ready')) as {registration: Record<string, unknown>};
      const body = route.request().postDataJSON();
      const registration = { ...previous.registration, step: path.endsWith('complete') ? 'done' : body.step,
        completed: path.endsWith('complete'), verified: true };
      overrides.set('/api/registration/status', {registration});
      return route.fulfill({json:{registration}});
    }
    if (route.request().method() !== 'GET') {
      unknown.push(`${route.request().method()} ${path}`);
      return route.fulfill({ status: 503, json: { message: 'Gangguan pengujian visual.' } });
    }
    if (state === 'loading') { pending.push(route); return; }
    if (state === 'error' || state === 'missing') return route.fulfill({ status: state === 'missing' ? 404 : 503, json: { message: 'Layanan pengujian belum tersedia.' } });
    try {
      const freshForm = path === '/api/registration/status' && new URL(page.url()).pathname === '/register';
      return route.fulfill({ json: overrides.has(path) ? overrides.get(path) : freshForm ? {registration:null} : responseFor(path, state) });
    }
    catch { unknown.push(path); return route.fulfill({ status: 500, json: { message: 'Fixture belum dipetakan.' } }); }
  });
  return { unknown, pending, overrides };
}
