import { defineConfig } from '@playwright/test';

/**
 * Electron smoke only — no browser projects. `_electron.launch` drives the built
 * app from `apps/desktop/out/main/index.js`, so `pnpm build` must run first.
 * CI runs this on Linux under `xvfb-run` (plan P0-5).
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
});
