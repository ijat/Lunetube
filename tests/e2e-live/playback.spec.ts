import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';

const mainEntry = fileURLToPath(new URL('../../apps/desktop/out/main/index.js', import.meta.url));

// "Costa Rica in 4K 60fps HDR" — the id used by video-normal.json, a real long VOD.
const VIDEO_ID = 'LXb3EKWsInQ';

/**
 * LIVE end-to-end playback: real InnerTube -> toDash -> loopback proxy -> shaka
 * in the renderer. This path has never been exercised by a human. Requires
 * network + an unblocked residential IP. Run with:
 *   pnpm playwright test --config playwright.live.config.ts
 */
test('live: a real video actually plays through renderer -> shaka', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'lunetube-live-'));
  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, LUNE_FAKE_YT: '' }, // force the REAL source
  });

  const notes: string[] = [];
  try {
    const page = await app.firstWindow();
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.evaluate((id) => {
      window.location.hash = `#/watch/${id}`;
    }, VIDEO_ID);

    // metadata should resolve from the real API
    await expect(page.getByTestId('watch-title')).not.toHaveText('', { timeout: 30_000 });
    notes.push(`title: ${await page.getByTestId('watch-title').textContent()}`);

    // click the poster to mount the player
    await page.locator('.watch__poster').click({ timeout: 15_000 });

    // wait for a <video> that is actually progressing
    const stats = await page.waitForFunction(
      () => {
        const v = document.querySelector('video');
        if (!v) return false;
        if (v.readyState >= 3 && v.currentTime > 0.5) {
          return {
            currentTime: v.currentTime,
            readyState: v.readyState,
            width: v.videoWidth,
            height: v.videoHeight,
            duration: v.duration,
            paused: v.paused,
          };
        }
        return false;
      },
      { timeout: 90_000, polling: 500 },
    );

    const s = await stats.jsonValue();
    notes.push(`playback: ${JSON.stringify(s)}`);

    expect(s).toBeTruthy();
    // @ts-expect-error narrowed above
    expect(s.currentTime).toBeGreaterThan(0.5);
    // @ts-expect-error narrowed above
    expect(s.width).toBeGreaterThan(0);

    // let it run a couple seconds and confirm currentTime advanced
    const t0 = (s as { currentTime: number }).currentTime;
    await page.waitForTimeout(3000);
    const t1 = await page.evaluate(() => document.querySelector('video')?.currentTime ?? 0);
    notes.push(`advanced: ${t0.toFixed(2)} -> ${t1.toFixed(2)}`);
    expect(t1).toBeGreaterThan(t0);

    notes.push(
      `console errors (${consoleErrors.length}): ${consoleErrors.slice(0, 8).join(' | ')}`,
    );
  } finally {
    console.log(
      '\n=== LIVE PLAYBACK NOTES ===\n' + notes.join('\n') + '\n===========================\n',
    );
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
