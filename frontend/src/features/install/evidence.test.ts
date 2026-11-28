import { afterEach, expect, it, vi } from 'vitest';
import { hasInstalledApplication } from './evidence';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup(check?: () => Promise<unknown>) {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }), location: { origin: 'https://example.test' } });
  vi.stubGlobal('navigator', { getInstalledRelatedApps: check });
}
it('requires the current web app identity rather than an unrelated installed application', async () => {
  setup(async () => [{ platform: 'webapp', url: 'https://other.test/manifest.webmanifest' }]);
  expect(await hasInstalledApplication()).toBe(false);
  setup(async () => [{ platform: 'webapp', url: 'https://example.test/manifest.webmanifest', id: 'https://example.test/' }]);
  expect(await hasInstalledApplication()).toBe(true);
});
it('bounds a hanging platform detection call and handles unsupported browsers', async () => {
  vi.useFakeTimers();
  setup(() => new Promise(() => {}));
  const checking = hasInstalledApplication();
  await vi.advanceTimersByTimeAsync(2600);
  expect(await checking).toBe(false);
  setup();
  expect(await hasInstalledApplication()).toBe(false);
});
