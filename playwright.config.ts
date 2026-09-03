import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

/**
 * Electron smoke only — no browser projects. `_electron.launch` drives the built
 * app from `apps/desktop/out/main/index.js`, so `pnpm build` must run first.
 * CI runs this on Linux under `xvfb-run` (plan P0-5).
 *
 * Every e2e spec runs the app against `FakeYouTubeSource` (plan P1-4): CI IPs are
 * bot-blocked and no e2e test may contact YouTube (plan R2). `electron.launch`
 * inherits `process.env` when a spec passes no explicit `env`, so setting these
 * here covers all specs. `LUNE_FIXTURES_DIR` is required because the bundled
 * `out/main` build cannot resolve the package-relative fixtures default.
 */
process.env['LUNE_FAKE_YT'] ??= '1';
process.env['LUNE_FIXTURES_DIR'] ??= fileURLToPath(
  new URL('./packages/youtube/tests/fixtures', import.meta.url),
);
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
});
