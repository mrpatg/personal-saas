/**
 * Regression tests: `npm test` builds the site, starts it on an empty local
 * database (scripts/test-server.mjs) and walks through every main feature
 * the way a person would. GitHub Actions runs it on every pull request.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.TEST_PORT ?? '8788';

export default defineConfig({
  testDir: 'tests',
  // The tests build on each other (admin → client → project → invoice), so run them in order.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    ...devices['Desktop Chrome'],
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
  webServer: {
    command: 'npm run build && node scripts/test-server.mjs',
    url: `http://localhost:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
