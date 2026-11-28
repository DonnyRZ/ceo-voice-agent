import { expect, test } from '@playwright/test';
import { mockVoiceApp, openVoice, startVoice } from '../e2e/ceo/voice-fixture';
import { emitVoice } from '../e2e/ceo/voice-transport';
import { capture } from './capture';
import { task, project, history, updatedAt } from './data';

test('ceo-voice__all-session-and-result-states', async ({ page }, info) => {
  // This scenario sweeps every state across 31 viewport/text combinations.
  if (process.env.UI_LAYOUT_SWEEP === '1') test.setTimeout(120_000);
  const server = await mockVoiceApp(page);
  await openVoice(page);
  await capture(page, info, 'voice__idle');
  await startVoice(page);
  await capture(page, info, 'voice__listening');
  await page.getByRole('button', { name: 'Bisukan mikrofon' }).click();
  await capture(page, info, 'voice__muted');
  await page.getByRole('button', { name: 'Aktifkan mikrofon' }).click();
  let generation = 0;
  for (const kind of ['clarify', 'no_match', 'unsupported', 'unavailable'] as const) {
    generation++;
    const turnId = `visual-${generation}`;
    await emitVoice(page, { type: 'turn', turnId, generation });
    await capture(page, info, `voice__searching-${kind}`);
    await emitVoice(page, { type: 'result', turnId, generation, result: { kind, text: 'Informasi belum dapat dipastikan untuk permintaan ini.' } });
    await capture(page, info, `voice__result-${kind}`);
  }
  for (const intent of ['status', 'pic', 'summary', 'history'] as const) {
    generation++;
    const turnId = `visual-${generation}`;
    await emitVoice(page, { type: 'turn', turnId, generation });
    await emitVoice(page, { type: 'result', turnId, generation, result: { kind: 'facts', text: 'Fakta pengujian visual.', facts: {
      intent, entity: { kind: 'project', id: project.id, name: project.name, divisionName: task.divisionName },
      status: intent === 'status' ? 'on_progress' : undefined, picName: intent === 'pic' ? null : task.picName,
      updatedAt, tasks: [task], history: intent === 'history' ? history : [],
      counts: intent === 'summary' ? { pending: 1, on_progress: 1, done: 0, total: 2 } : undefined,
      statusFilter: intent === 'summary' ? ['pending', 'on_progress'] : undefined,
      period: { from: '2026-11-01', to: '2026-11-30' }, asOf: intent === 'history' ? updatedAt : undefined,
    } } });
    await expect(page.getByRole('region', { name: 'Menurut timesheet', exact: true })).toBeVisible();
    if (await page.locator('.ceo-reference details').getAttribute('open') !== null) {
      await page.getByText('Catatan yang dirujuk', { exact: true }).click();
    }
    await capture(page, info, `voice__facts-${intent}`);
    await page.getByText('Catatan yang dirujuk', { exact: true }).click();
    await expect(page.locator('.ceo-reference details')).toHaveAttribute('open', '');
    await capture(page, info, `voice__sources-expanded-${intent}`);
    await emitVoice(page, { type: 'playback', turnId, generation, allowed: true });
    await expect(page.getByText('Menjawab', { exact: true })).toBeVisible();
    await capture(page, info, `voice__answering-${intent}`);
  }
  await emitVoice(page, { type: 'state', state: 'standby' });
  await capture(page, info, 'voice__standby');
  await page.getByRole('button', { name: 'Akhiri sesi', exact: true }).click();
  await capture(page, info, 'voice__closed');
  await startVoice(page, 2);
  await page.evaluate(() => window.rkVoiceTest.disconnect());
  await expect(page.getByText('Koneksi terputus', { exact: true })).toBeVisible();
  await capture(page, info, 'voice__disconnected');
  expect(server.providerRequests).toEqual([]);
});

for (const failure of ['microphone', 'start']) test(`ceo-voice__${failure}-failure`, async ({ page }, info) => {
  await mockVoiceApp(page, { denyMicrophone: failure === 'microphone', startStatus: failure === 'start' ? 503 : undefined });
  await openVoice(page);
  await page.getByRole('button', { name: 'Mulai ngobrol', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await capture(page, info, `voice__${failure}-failure`);
});
