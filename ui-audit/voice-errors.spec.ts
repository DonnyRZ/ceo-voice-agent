import { expect, test } from '@playwright/test';
import { mockVoiceApp, openVoice, startVoice, sessionsPath } from '../e2e/ceo/voice-fixture';
import { emitVoice } from '../e2e/ceo/voice-transport';
import { capture } from './capture';

test('voice__connecting', async ({ page }, info) => {
  await mockVoiceApp(page);
  await page.route((url) => url.pathname === sessionsPath, () => undefined);
  await openVoice(page);
  await page.getByRole('button', { name: 'Mulai ngobrol', exact: true }).click();
  await expect(page.getByText('Menghubungkan', { exact: true })).toBeVisible();
  await capture(page, info, 'voice__connecting');
});

for (const state of ['blocked', 'invalid', 'unverified', 'revoked', 'timeout']) test(`voice__${state}`, async ({ page }, info) => {
  await mockVoiceApp(page, { invalidAudio: state === 'invalid' });
  await openVoice(page);
  await startVoice(page);
  if (state === 'revoked' || state === 'timeout') {
    await emitVoice(page, { type: 'state', state: 'closed', reason: state });
    await expect(page.getByRole('alert')).toBeVisible();
  } else {
    if (state === 'blocked') await page.evaluate(() => {
      HTMLMediaElement.prototype.play = async () => { throw new DOMException('Autoplay blocked', 'NotAllowedError'); };
    });
    const turn = { turnId: 'visual-errors', generation: 1 };
    await emitVoice(page, { type: 'turn', ...turn });
    await emitVoice(page, { type: 'playback', ...turn, allowed: state !== 'unverified', ...(state === 'unverified' ? { reason: 'unverified' as const } : {}) });
    if (state === 'blocked') await expect(page.getByRole('button', { name: 'Putar audio' })).toBeVisible();
    else await expect(page.getByRole('alert')).toBeVisible();
  }
  await capture(page, info, `voice__${state}`);
});
