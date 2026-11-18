import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
// Node reads `.env` for the DB owner URL (platform-admin seeding and cleanup). Existing environment variables win.
try { process.loadEnvFile(resolve(root, '.env')); } catch { /* CI creates it; locally it is optional */ }

process.env.E2E_RUN ??= `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;

export const API_PORT = 4100;
export const WEB_PORT = 3200;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  workers: 1, // tests share one database and one API process; they are independent but not run in parallel
  fullyParallel: false,
  retries: CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]] : [['list']],
  outputDir: '../test-results',
  globalTeardown: './global-teardown.ts',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    channel: 'chrome', // the installed Google Chrome: no browser download
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node --env-file=../../.env dist/main.js',
      cwd: resolve(root, 'apps/api'),
      url: `http://localhost:${API_PORT}/health/ready`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        API_PORT: String(API_PORT), WEB_ORIGIN: `http://localhost:${WEB_PORT}`, PUBLIC_API_URL: `http://localhost:${API_PORT}`,
        NODE_ENV: 'development', SIGNUP_PLAN: 'growth', WORKERS_ENABLED: 'true', THROTTLE_GLOBAL_LIMIT: '100000', THROTTLE_AUTH_LIMIT: '1000',
        QUEUE_PREFIX: 'e2e', AI_PROVIDER: 'mock', RAZORPAY_MODE: 'mock', WHATSAPP_MODE: 'mock', VIRUS_SCAN_MODE: 'mock',
        // Embedded Signup stand-in (ADR 0012): no Facebook; the page shows a small test dialog and the platform webhook is signed with this secret.
        EMBEDDED_SIGNUP_MODE: 'mock', META_APP_SECRET: 'e2e-platform-meta-app-secret-0123456789',
        PLATFORM_JWT_SECRET: 'e2e-platform-secret-at-least-32-characters-long', AI_KILL_SWITCH: 'false',
      },
    },
    {
      command: `pnpm exec next start -p ${WEB_PORT}`,
      cwd: resolve(root, 'apps/web'),
      url: `http://localhost:${WEB_PORT}/login`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { NEXT_DIST_DIR: 'node_modules/.cache/next-e2e', NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
