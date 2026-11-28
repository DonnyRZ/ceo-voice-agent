import { defineConfig } from '@playwright/test';
import application from './playwright.config';

export default defineConfig({
  ...application,
  testDir: './ui-audit',
  testMatch: '**/*.spec.ts',
  use: { ...application.use, baseURL: 'http://127.0.0.1:5174' },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --config vite.ui-audit.config.ts --host 127.0.0.1 --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174/login',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  outputDir: `test-results/ui-audit-${process.env.UI_AUDIT_PHASE ?? 'after'}`,
  workers: 2,
  reporter: [['list'], ['json', { outputFile: `test-results/ui-audit-${process.env.UI_AUDIT_PHASE ?? 'after'}/results.json` }]],
});
