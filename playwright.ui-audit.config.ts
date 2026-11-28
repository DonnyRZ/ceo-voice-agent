import { defineConfig } from '@playwright/test';
import application from './playwright.config';

export default defineConfig({
  ...application,
  testDir: './ui-audit',
  testMatch: '**/*.spec.ts',
  // This suite renders controlled API states; SW/native behavior is verified by separate E2E tests.
  use: { ...application.use, baseURL: 'http://127.0.0.1:5174', serviceWorkers: 'block' },
  webServer: {
    command: 'npm run build && node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174/login',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  outputDir: `test-results/ui-audit-${process.env.UI_AUDIT_PHASE ?? 'after'}`,
  workers: 2,
  reporter: [['list'], ['json', { outputFile: `test-results/ui-audit-${process.env.UI_AUDIT_PHASE ?? 'after'}/results.json` }]],
});
