import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const target = new URL(baseURL);
const loopback = ["localhost", "127.0.0.1", "[::1]"];

if (!loopback.includes(target.hostname)) {
  throw new Error("Playwright needs a local development server wired to a test database.");
}

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results/e2e",
  forbidOnly: true,
  reporter: "list",
  timeout: 40_000,
  webServer: {
    command: "npm run dev",
    url: new URL("/api/health", baseURL).href,
    timeout: 45_000,
    reuseExistingServer: !process.env.CI,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
});
