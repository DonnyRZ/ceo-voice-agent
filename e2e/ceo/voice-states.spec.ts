import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mockVoiceApp, openVoice, startVoice } from './voice-fixture';
import { emitVoice, readTransport } from './voice-transport';

const reference = (page: Page, last = false) => page.getByRole('region', { name: last ? 'Jawaban terakhir' : 'Menurut timesheet', exact: true });
const facts = {
  kind: 'facts', text: 'Aplikasi A Mobile berstatus On Progress, PIC Doni.',
  facts: {
    intent: 'status', entity: { kind: 'project', id: 'project-reference', name: 'Aplikasi A Mobile', divisionName: 'IT' },
    status: 'on_progress', picName: 'Doni', updatedAt: '2026-11-26T02:15:00Z',
  },
};

async function answer(page: Page, generation: number) {
  const turnId = `state-turn-${generation}`;
  await emitVoice(page, { type: 'turn', turnId, generation });
  await emitVoice(page, { type: 'result', turnId, generation, result: facts });
  await emitVoice(page, { type: 'playback', turnId, generation, allowed: true });
}

async function capture(page: Page, info: TestInfo, state: string) {
  const path = info.outputPath(`voice-${state}.png`);
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  await info.attach(`Voice Agent ${state}`, { path, contentType: 'image/png' });
}

async function playbackPreference(page: Page, enabled: boolean) {
  await page.evaluate(async (playVoiceAnswers) => {
    const { user } = await (await fetch('/api/session')).json() as { user: { id: string } };
    localStorage.setItem(`ruangkerja:ceo:preferences:${user.id}`, JSON.stringify({ version: 1, playVoiceAnswers }));
    window.dispatchEvent(new Event('ruangkerja:ceo-preferences-changed'));
  }, enabled);
}

test('tujuh kondisi Voice Agent mengikuti sesi nyata di browser dan mempertahankan jawaban akhir', async ({ page }, info) => {
  const server = await mockVoiceApp(page);
  await openVoice(page);
  await expect(reference(page)).toHaveCount(0);
  await capture(page, info, '01-idle');

  await startVoice(page);
  await capture(page, info, '02-listening');
  await emitVoice(page, { type: 'turn', turnId: 'state-turn-1', generation: 1 });
  await expect(page.getByText('Mencari informasi', { exact: true })).toBeVisible();
  await expect(reference(page)).toHaveCount(0);
  await capture(page, info, '03-searching');
  await emitVoice(page, { type: 'result', turnId: 'state-turn-1', generation: 1, result: facts });
  await expect(reference(page).getByText('PIC Doni', { exact: true })).toBeVisible();
  await expect(page.locator('audio')).toHaveJSProperty('muted', true);
  await emitVoice(page, { type: 'playback', turnId: 'state-turn-1', generation: 1, allowed: true });
  await expect(page.getByText('Menjawab', { exact: true })).toBeVisible();
  await capture(page, info, '04-answering');

  await emitVoice(page, { type: 'state', state: 'standby' });
  await expect(page.getByText('Standby', { exact: true })).toBeVisible();
  await expect(reference(page, true).getByText('Aplikasi A Mobile', { exact: true })).toBeVisible();
  await expect(page.locator('audio')).toHaveJSProperty('muted', true);
  await capture(page, info, '05-standby');

  await page.getByRole('button', { name: 'Akhiri sesi', exact: true }).click();
  await expect(page.getByText('Sesi selesai', { exact: true })).toBeVisible();
  await expect(reference(page, true).getByText('Aplikasi A Mobile', { exact: true })).toBeVisible();
  await expect.poll(() => server.closed.length).toBe(1);
  await capture(page, info, '06-closed');

  await startVoice(page, 2);
  await page.evaluate(() => window.rkVoiceTest.disconnect());
  await expect(page.getByText('Koneksi terputus', { exact: true })).toBeVisible();
  await expect(reference(page)).toHaveCount(0);
  await expect(reference(page, true)).toHaveCount(0);
  await capture(page, info, '07-disconnected');
  expect(server.providerRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('akhir audio dan interupsi kembali mendengarkan, lalu pencabutan akses menghapus fakta', async ({ page }) => {
  await mockVoiceApp(page);
  await openVoice(page);
  await startVoice(page);
  await answer(page, 1);
  await expect(page.getByText('Menjawab', { exact: true })).toBeVisible();
  await page.locator('audio').evaluate((audio) => {
    Object.defineProperty(audio, 'ended', { configurable: true, value: true });
    audio.dispatchEvent(new Event('ended'));
  });
  await expect(page.getByText('Mendengarkan', { exact: true })).toBeVisible();
  await expect(page.locator('audio')).not.toHaveAttribute('src', /^blob:/);
  await expect(reference(page)).toBeVisible();

  await answer(page, 2);
  await expect(page.getByText('Menjawab', { exact: true })).toBeVisible();
  await page.evaluate(() => window.rkVoiceTest.localSpeech());
  await expect(page.getByText('Mendengarkan', { exact: true })).toBeVisible();
  await expect(page.locator('audio')).toHaveJSProperty('muted', true);
  await emitVoice(page, { type: 'state', state: 'closed', reason: 'revoked' });
  await expect(page.getByRole('alert')).toHaveText('Akses Voice Agent CEO dicabut.');
  await expect(reference(page)).toHaveCount(0);
  await expect(reference(page, true)).toHaveCount(0);
});

test('preferensi suara menahan audio tetapi menyimpan fakta, tanpa memutar ulang jawaban lama', async ({ page }) => {
  const server = await mockVoiceApp(page);
  await openVoice(page);
  await playbackPreference(page, false);
  await startVoice(page);
  await answer(page, 1);
  await expect(reference(page).getByText('Aplikasi A Mobile', { exact: true })).toBeVisible();
  await expect(page.getByText('Mendengarkan', { exact: true })).toBeVisible();
  expect((await readTransport(page)).audiblePlays).toBe(0);
  expect(server.requests.filter(({ path }) => path.endsWith('/audio') || path.endsWith('/telemetry'))).toHaveLength(0);

  await playbackPreference(page, true);
  await emitVoice(page, { type: 'playback', turnId: 'state-turn-1', generation: 1, allowed: true });
  expect((await readTransport(page)).audiblePlays).toBe(0);
  await answer(page, 2);
  await expect.poll(async () => (await readTransport(page)).audiblePlays).toBe(1);
  await expect(page.getByText('Menjawab', { exact: true })).toBeVisible();
  await playbackPreference(page, false);
  await expect(page.locator('audio')).toHaveJSProperty('muted', true);
  await expect(page.locator('audio')).not.toHaveAttribute('src', /^blob:/);
  await expect(reference(page)).toBeVisible();
  await playbackPreference(page, true);
  await emitVoice(page, { type: 'playback', turnId: 'state-turn-2', generation: 2, allowed: true });
  expect((await readTransport(page)).audiblePlays).toBe(1);
  await answer(page, 3);
  await expect.poll(async () => (await readTransport(page)).audiblePlays).toBe(2);
  await expect.poll(() => server.requests.filter(({ path }) => path.endsWith('/telemetry')).length).toBe(2);
  expect(server.providerRequests).toEqual([]);
});
