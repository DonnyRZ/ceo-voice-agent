import { expect, test } from '@playwright/test';
import { mockVoiceApp, openVoice, startVoice } from './voice-fixture';
import { emitVoice } from './voice-transport';

test('rekap terfilter menjelaskan cakupan dan tidak menampilkan nol untuk status yang dikecualikan', async ({ page }) => {
  await mockVoiceApp(page);
  await openVoice(page);
  await startVoice(page);
  const turn = { turnId: 'filtered-summary', generation: 1 };
  await emitVoice(page, { type: 'turn', ...turn });
  await emitVoice(page, { type: 'result', ...turn, result: {
    kind: 'facts', text: 'Ada tujuh tugas selesai sejak awal November.', facts: {
      intent: 'summary', entity: { kind: 'division', id: 'division-source', name: 'IT' },
      period: { from: '2026-11-01' }, statusFilter: ['done'],
      counts: { pending: 0, on_progress: 0, done: 7, total: 7 },
    },
  } });
  const card = page.getByRole('region', { name: 'Menurut timesheet', exact: true });
  await expect(card.getByText('Filter status: Done', { exact: true })).toBeVisible();
  await expect(card.locator('dt')).toHaveText(['Done', 'Jumlah sesuai filter']);
  await expect(card.locator('dd')).toHaveText(['7', '7']);
  await expect(card.getByText('Sejak 2026-11-01', { exact: true })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Lihat sumber', exact: true })).toHaveAttribute('href', '/ceo/divisions/division-source?voiceFrom=2026-11-01');
});

test('jawaban historis mengikat tautan sumber pada cutoff dan periode yang dirujuk', async ({ page }) => {
  await mockVoiceApp(page);
  await openVoice(page);
  await startVoice(page);
  const turn = { turnId: 'historical-source', generation: 1 };
  await emitVoice(page, { type: 'turn', ...turn });
  await emitVoice(page, { type: 'result', ...turn, result: {
    kind: 'facts', text: 'Pada akhir Februari tugas itu masih Pending.', facts: {
      intent: 'status', entity: { kind: 'task', id: 'task-source', name: 'Migrasi server' }, status: 'pending',
      asOf: '2024-02-29T23:59:59+07:00', period: { from: '2024-02-01', to: '2024-02-29' },
    },
  } });
  const card = page.getByRole('region', { name: 'Menurut timesheet', exact: true });
  await expect(card.getByText('Pending', { exact: true })).toBeVisible();
  const href = await card.getByRole('link', { name: 'Lihat sumber', exact: true }).getAttribute('href');
  const url = new URL(href!, 'http://localhost');
  expect(url.searchParams.get('voiceAsOf')).toBe('2024-02-29');
  expect(url.searchParams.get('month')).toBe('2024-02');
  expect(url.searchParams.get('voiceFrom')).toBe('2024-02-01');
  expect(url.searchParams.get('voiceTo')).toBe('2024-02-29');
});
