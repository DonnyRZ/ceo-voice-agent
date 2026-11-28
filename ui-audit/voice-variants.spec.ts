import { expect, test } from '@playwright/test';
import { mockVoiceApp, openVoice, startVoice } from '../e2e/ceo/voice-fixture';
import { emitVoice } from '../e2e/ceo/voice-transport';
import { capture } from './capture';
import { task, history, updatedAt } from './data';

for (const variant of ['global-summary', 'task', 'division', 'history-only', 'facts-autoplay-blocked']) {
  test(`voice__facts-variant-${variant}`, async ({ page }, info) => {
    await mockVoiceApp(page);
    await openVoice(page);
    await startVoice(page);
    const turn = { turnId: 'visual-variant', generation: 1 };
    const global = variant === 'global-summary';
    await emitVoice(page, { type: 'turn', ...turn });
    await emitVoice(page, { type: 'result', ...turn, result: { kind: 'facts', text: 'Fakta pengujian visual.', facts: {
      intent: global ? 'summary' : variant === 'history-only' ? 'history' : 'status',
      entity: global ? undefined : { kind: variant === 'division' ? 'division' : 'task', id: 'record-1', name: variant === 'division' ? task.divisionName : task.title },
      counts: global ? { pending: 1, on_progress: 1, done: 1, total: 3 } : undefined,
      status: global || variant === 'history-only' ? undefined : 'pending',
      tasks: global || variant === 'history-only' ? [] : [task],
      history: variant === 'history-only' ? history : [],
      asOf: variant === 'history-only' ? updatedAt : undefined,
    } } });
    await expect(page.getByRole('region', { name: 'Menurut timesheet', exact: true })).toBeVisible();
    if (variant === 'facts-autoplay-blocked') {
      await page.evaluate(() => { HTMLMediaElement.prototype.play = async () => { throw new DOMException('Autoplay blocked', 'NotAllowedError'); }; });
      await emitVoice(page, { type: 'playback', ...turn, allowed: true });
      await expect(page.getByRole('button', { name: 'Putar audio' })).toBeVisible();
    }
    await capture(page, info, `voice__variant-${variant}`);
    if (variant === 'history-only') {
      await page.getByText('Catatan yang dirujuk', { exact: true }).click();
      await capture(page, info, 'voice__history-only-expanded');
    }
  });
}
