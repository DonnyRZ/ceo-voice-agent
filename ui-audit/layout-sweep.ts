import { expect, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { inspectLayout } from './layout-integrity';

export async function sweepLayout(page: Page, info: TestInfo, name: string) {
  const original = page.viewportSize();
  if (!original || original.width >= 768 || process.env.UI_LAYOUT_SWEEP !== '1') return;
  const originalFont = await page.evaluate(() => document.documentElement.style.fontSize);
  const samples = [
    ...[300, 320, 350, 359, 360, 374, 375, 390, 412, 430, 480, 600, 767, 768, 800, 844, 932, 1024].map(width => ({ width, height: 844, scale: 1 })),
    ...[1.25, 1.5].flatMap(scale => [320, 360, 390, 767].map(width => ({ width, height: 844, scale }))),
    { width: 360, height: 568, scale: 1 }, { width: 390, height: 667, scale: 1 }, { width: 430, height: 932, scale: 1 },
    { width: 844, height: 390, scale: 1 }, { width: 932, height: 430, scale: 1 },
  ];
  const results = [];
  let capturedFailure = false;
  try {
    for (const sample of samples) {
      await page.setViewportSize({ width: sample.width, height: sample.height });
      await page.evaluate(scale => {
        document.documentElement.style.fontSize = `${16 * scale}px`;
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      }, sample.scale);
      const issues = await page.evaluate(inspectLayout);
      results.push({ ...sample, issues });
      if (issues.length && !capturedFailure) {
        await page.screenshot({ path: info.outputPath(`${name}--layout-failure.png`), fullPage: true });
        capturedFailure = true;
      }
    }
    await writeFile(info.outputPath(`${name}--layout.json`), JSON.stringify(results, null, 2));
  } finally {
    await page.setViewportSize(original);
    await page.evaluate(font => { document.documentElement.style.fontSize = font; }, originalFont);
    // Chromium mobile emulation can retain a visual zoom after repeated viewport
    // changes. Restore the test viewport before the next real pointer action.
    if (page.context().browser()?.browserType().name() === 'chromium') {
      const session = await page.context().newCDPSession(page);
      try { await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }); }
      finally { await session.detach(); }
    }
    await page.evaluate(async () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      await new Promise(requestAnimationFrame);
    });
  }
  expect(results.filter(sample => sample.issues.length), `${name}: mobile layout integrity`).toEqual([]);
}
