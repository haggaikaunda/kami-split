import { defineConfig } from '@playwright/test';
import {
  authOrigin,
  origin,
  output,
  webPort,
} from './scripts/browser/settings.mjs';

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: `${output}/artifacts`,
  reporter: [
    ['list'],
    ['html', { outputFolder: `${output}/report`, open: 'never' }],
    ['./scripts/browser/required-reporter.mjs'],
  ],
  use: {
    baseURL: origin,
    browserName: 'chromium',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  projects: [390, 1280].map((width) => ({
    name: `chromium-${width}`,
    use: { viewport: { width, height: 900 } },
  })),
  webServer: [
    {
      name: 'Synthetic Auth',
      command: 'node scripts/browser/auth-server.mjs',
      url: `${authOrigin}/health`,
      reuseExistingServer: false,
      timeout: 15_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
    {
      name: 'Production Next',
      command: `${process.env.BROWSER_SKIP_BUILD === '1' ? '' : 'pnpm build && '}node apps/web/node_modules/next/dist/bin/next start apps/web --hostname 127.0.0.1 --port ${webPort}`,
      url: `${origin}/sign-in`,
      env: {
        ONBOARDING_PUBLIC_SUPABASE_URL: authOrigin,
        ONBOARDING_PUBLIC_SUPABASE_KEY: 'synthetic-public',
        ONBOARDING_ORIGIN: origin,
      },
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
  ],
});
