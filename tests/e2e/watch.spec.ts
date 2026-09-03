import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';

const mainEntry = fileURLToPath(new URL('../../apps/desktop/out/main/index.js', import.meta.url));

/**
 * P1-4 done-criterion: with `LUNE_FAKE_YT=1` (set in playwright.config.ts), the
 * watch route calls `useVideo` → `yt:video` IPC → `FakeYouTubeSource` and renders
 * the fixture's title, with zero console errors. `LXb3EKWsInQ` is the id of
 * `packages/youtube/tests/fixtures/video-normal.json`.
 */
test('watch route renders a fixture video title over IPC with no console errors', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'lunetube-e2e-watch-'));
  const app = await electron.launch({ args: [mainEntry, `--user-data-dir=${userDataDir}`] });

  try {
    const page = await app.firstWindow();

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.evaluate(() => {
      window.location.hash = '#/watch/LXb3EKWsInQ';
    });

    await expect(page.getByTestId('watch-title')).toHaveText(
      'Costa Rica in 4K 60fps HDR (ULTRA HD)',
    );

    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
