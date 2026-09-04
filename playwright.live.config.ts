import { defineConfig } from '@playwright/test';

/**
 * LIVE acceptance config — NOT part of CI. Deliberately does NOT set
 * LUNE_FAKE_YT, so the app talks to the real InnerTube + real googlevideo
 * through the loopback proxy. Used for the post-Phase-1 manual playback check.
 */
export default defineConfig({
  testDir: './tests/e2e-live',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 120_000,
  expect: { timeout: 30_000 },
});
