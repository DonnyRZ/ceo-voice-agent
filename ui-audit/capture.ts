import { expect, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { sweepLayout } from './layout-sweep';
import { inspectLayout } from './layout-integrity';

const capturedNames = new WeakMap<TestInfo, Map<string, number>>();

export async function capture(page: Page, info: TestInfo, name: string) {
  const names = capturedNames.get(info) ?? new Map<string, number>();
  const occurrence = (names.get(name) ?? 0) + 1;
  names.set(name, occurrence);
  capturedNames.set(info, names);
  if (occurrence > 1) name += `--${occurrence}`;
  const viewport = page.viewportSize();
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    await new Promise(requestAnimationFrame);
  });
  const metrics = await page.evaluate((viewport) => {
    const visible = (el: Element) => {
      const style = getComputedStyle(el), box = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
        && style.clipPath !== 'inset(50%)' && box.width > 1 && box.height > 1;
    };
    const measure = (selector: string) => [...document.querySelectorAll(selector)].filter(visible).map((el) => {
      const box = el.getBoundingClientRect(), style = getComputedStyle(el);
      const category = el.closest('.ceo-voice-orb') ? 'voice' : el.closest('.side-navigation, .mobile-navigation, .ceo-side-nav, .ceo-bottom-nav') ? 'nav'
        : el.closest('.status-badge, .ts-status, .mgmt-badge, .ts-status-option, .registration-steps') ? 'status'
          : el.matches('.dashboard-stat-icon') || el.closest('.ceo-status-total, .mgmt-stat-icon, .admin-stat') ? 'stat'
            : el.closest('.mgmt-tile, .admin-tile, .ts-icon-tile, .project-icon, .ceo-icon-tile, .auth-intro-icon, .registration-intro-icon, .registration-status-icon, .superadmin-shield, .dashboard-team-icon, .dashboard-project-icon, .dashboard-open-icon, .superadmin-login-eyebrow')
              || el.matches('.ceo-setting-heading > svg, .ceo-security-form header > svg, .registration-feature-icon, .install-confirmed') || el.closest('.install-instructions, .install-platform') ? 'feature' : 'inline';
      return { text: el.textContent?.trim().slice(0, 90), class: el.getAttribute('class'), width: +box.width.toFixed(2), height: +box.height.toFixed(2), font: parseFloat(style.fontSize), cssWidth: parseFloat(style.width), cssHeight: parseFloat(style.height), category, hero: !!el.closest('.superadmin-login-intro') };
    });
    return {
      viewport: viewport ?? { width: document.documentElement.clientWidth, height: innerHeight },
      browserViewport: { innerWidth, innerHeight, clientWidth: document.documentElement.clientWidth },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      loadingDots: [...document.querySelectorAll('[role="status"], button, option')].filter(visible)
        .map(el => el.textContent ?? '').filter(text => /(?:…|\.{3})/.test(text)
          && /memuat|memeriksa|memverifikasi|menyimpan|mengirim|memproses|mengaktifkan|menyiapkan|membuka|sedang (masuk|keluar)|loading/i.test(text)),
      spinners: [...document.querySelectorAll('.ui-spinner, .install-spinner, .ceo-voice-spin')].filter(visible)
        .map(el => ({ animation: getComputedStyle(el).animationName, width: el.getBoundingClientRect().width })),
      logos: measure('.brand'), appIcons: measure('.install-app-icon'), titles: measure('h1'), sections: measure('h2'),
      tiles: measure('.mgmt-tile, .admin-tile, .ts-icon-tile, .project-icon, .ceo-icon-tile, .dashboard-team-icon, .dashboard-project-icon, .dashboard-open-icon, .auth-intro-icon, .registration-intro-icon, .registration-status-icon, .superadmin-shield'),
      buttons: measure('.ui-button, .ts-button, .mgmt-button, .project-button'),
      inputs: measure('input:not([type=month]):not([type=radio]):not([type=checkbox]), select'),
      badges: measure('.status-badge, .ts-status, .mgmt-badge'),
      navigation: measure('.side-navigation a, .mobile-navigation a, .ceo-side-nav a, .ceo-bottom-nav a'), icons: measure('svg'),
    };
  }, viewport);
  const layoutIssues = await page.evaluate(inspectLayout);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled' });
  await writeFile(info.outputPath(`${name}.json`), JSON.stringify({ ...metrics, layoutIssues }, null, 2));
  if (process.env.UI_AUDIT_PHASE !== 'before') {
    expect(layoutIssues, `${name}: rendered layout integrity`).toEqual([]);
    expect(metrics.loadingDots, `${name}: replaced loading labels`).toEqual([]);
    for (const spinner of metrics.spinners) expect(spinner.animation, `${name}: spinner animation`).not.toBe('none');
    expect(metrics.document.width, `${name}: horizontal overflow`).toBeLessThanOrEqual(metrics.viewport.width);
    const title = metrics.viewport.width < 768 ? 28 : 32;
    for (const h of metrics.titles) expect(h.font, `${name}: page title ${h.text}`).toBe(title);
    for (const h of metrics.sections) expect(h.font, `${name}: section ${h.text}`).toBe(h.hero ? title : metrics.viewport.width < 768 ? 20 : 22);
    for (const logo of metrics.logos) expect(logo.width, `${name}: logo`).toBe(metrics.viewport.width < 768 ? 180 : 220);
    for (const icon of metrics.appIcons) { expect(icon.width).toBe(112); expect(icon.height).toBe(112); }
    for (const tile of metrics.tiles) {
      const size = metrics.viewport.width < 768 ? 48 : 56;
      expect(tile.width, `${name}: tile ${tile.class}`).toBe(size);
      expect(tile.height, `${name}: tile height ${tile.class}`).toBe(size);
    }
    for (const button of metrics.buttons) {
      expect(button.font, `${name}: button font ${button.text}`).toBe(16);
      expect(button.height, `${name}: button height ${button.text}`).toBeGreaterThanOrEqual(48);
    }
    for (const input of metrics.inputs) {
      expect(input.font, `${name}: control font`).toBe(16);
      expect(input.height, `${name}: control height`).toBe(48);
    }
    for (const badge of metrics.badges) expect(badge.font, `${name}: badge ${badge.text}`).toBe(14);
    for (const nav of metrics.navigation) expect(nav.font, `${name}: navigation ${nav.text}`).toBe(metrics.viewport.width < 768 ? 12 : 16);
    const iconSizes: Record<string, number> = { inline: 20, status: 18, nav: 24, stat: 36, feature: 28, voice: metrics.viewport.width <= 800 ? 60 : 82 };
    for (const icon of metrics.icons) {
      expect(icon.cssWidth, `${name}: icon ${icon.class} (${icon.category})`).toBe(iconSizes[icon.category]);
      expect(icon.cssHeight, `${name}: icon height ${icon.class}`).toBe(iconSizes[icon.category]);
    }
    if (['/login', '/superadmin'].includes(new URL(page.url()).pathname)) {
      expect(metrics.document.height, `${name}: login scroll`).toBeLessThanOrEqual(metrics.viewport.height);
    }
  }
  await sweepLayout(page, info, name);
  return metrics;
}
