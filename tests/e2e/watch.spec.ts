import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';

const mainEntry = fileURLToPath(new URL('../../apps/desktop/out/main/index.js', import.meta.url));

/**
 * Watch route (plan P1-4 done-criterion + P1-6). With `LUNE_FAKE_YT=1` (set in
 * playwright.config.ts) the route calls `useVideo` → `yt:video` IPC →
 * `FakeYouTubeSource` and renders the fixture title, with zero console errors.
 * `LXb3EKWsInQ` is the id of `packages/youtube/tests/fixtures/video-normal.json`.
 *
 * P1-6 additions:
 *  - the Direction-B watch page must contain **no** element that computes to a
 *    monospace font (PRD §7 is locked; F5 conflict 1);
 *  - the player mounts on the first play click, not on route entry — so under
 *    the fake source (expired googlevideo URLs) nothing tries to stream and the
 *    zero-console-errors gate holds.
 */
test('watch route: fixture title, click-to-play poster, no console errors, no monospace', async () => {
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

    // Player is not auto-mounted: the poster with its play button is shown.
    await expect(page.locator('.watch__poster')).toBeVisible();
    await expect(page.getByTestId('player-surface')).toHaveCount(0);

    // No element in the watch route may compute to a monospace family.
    const monoOffenders = await page.evaluate(() => {
      const MONO = /mono|menlo|consolas|courier|ui-monospace/i;
      const root = document.querySelector('.watch');
      if (!root) return ['(.watch not found)'];
      const bad: string[] = [];
      for (const el of [root, ...root.querySelectorAll('*')]) {
        const ff = getComputedStyle(el).fontFamily;
        if (MONO.test(ff)) bad.push(`${el.tagName}.${(el as HTMLElement).className}: ${ff}`);
      }
      return bad;
    });
    expect(monoOffenders).toEqual([]);

    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
