import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type Page } from '@playwright/test';

const mainEntry = fileURLToPath(new URL('../../apps/desktop/out/main/index.js', import.meta.url));

/**
 * The Phase-2 sweep (plan P2-11). One spec walks the whole phase against
 * `FakeYouTubeSource` (`LUNE_FAKE_YT=1`, set in playwright.config.ts):
 *
 *   type a query → suggestions → Enter → result cards → "Load more" → page 2 →
 *   click a card → watch route → comments → expand a thread → replies →
 *   click the WatchMeta channel link → channel route → `page.goBack()` to watch →
 *   forward to channel again → Videos paginates → Playlists tab →
 *   Home shows "Continue watching" with the video just visited.
 *
 * Throughout: **zero console errors**, and **no element computing to a
 * monospace family** across `.search`, `.comments`, `.channel`, `.home`
 * (extending P1-6's `.watch` walk).
 *
 * Fixture wiring (P2-11): `search-basic.json`'s first Video is `dQw4w9WgXcQ`,
 * which has `video-dQw4w9WgXcQ.json` + `comments-basic.json` (`dQw4w9WgXcQ|top`),
 * and its channel / pinned-comment author is `UC1111111111111111111111`
 * (`channel-videos.json` — "Lofi Girl").
 */

/** Every element under `selector` that computes to a fixed-pitch font family. */
async function monoOffenders(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const MONO = /mono|menlo|consolas|courier|ui-monospace/i;
    const root = document.querySelector(sel);
    if (!root) return [`(${sel} not found)`];
    const bad: string[] = [];
    for (const el of [root, ...root.querySelectorAll('*')]) {
      const ff = getComputedStyle(el).fontFamily;
      if (MONO.test(ff)) bad.push(`${el.tagName}.${(el as HTMLElement).className}: ${ff}`);
    }
    return bad;
  }, selector);
}

test('browse sweep: search → watch → comments → channel → home continue-watching', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'lunetube-e2e-browse-'));
  const app = await electron.launch({ args: [mainEntry, `--user-data-dir=${userDataDir}`] });

  try {
    const page = await app.firstWindow();

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));
    await page.reload({ waitUntil: 'domcontentloaded' });

    // ---- Home: fresh-install hero (no recents yet) ----
    await expect(page.locator('.home--hero')).toBeVisible();

    // ---- Type a query → suggestions appear → Enter ----
    const search = page.locator('#topbar-search');
    await search.click();
    await search.pressSequentially('lofi', { delay: 30 });
    await expect(page.getByRole('listbox', { name: 'Search suggestions' })).toBeVisible();
    await search.press('Enter');

    // ---- Search results render ----
    await expect(page.locator('.search')).toBeVisible();
    await expect(page.locator('.search .card').first()).toBeVisible();
    expect(await monoOffenders(page, '.search')).toEqual([]);

    // ---- "Load more" yields page 2 ----
    // The sentinel only auto-pages after a real scroll (useInfiniteScrollSentinel),
    // so on this short fixture page the button is the load path and stays put
    // until clicked — no check-then-act race with an auto-load.
    const loadMore = page.getByRole('button', { name: 'Load more' });
    await loadMore.click();
    await expect(loadMore).toHaveCount(0);
    await page.locator('.stage__content').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect(page.getByText('Lofi Radio — Page 2 Result A')).toBeVisible();

    // ---- Click the first card → watch route ----
    await page.locator('a.card[href*="dQw4w9WgXcQ"]').first().click();
    await expect(page.getByTestId('watch-title')).toHaveText(
      'Lofi Hip Hop Radio — beats to relax/study to',
    );

    // ---- Comments render ----
    await expect(page.locator('.comments')).toBeVisible();
    await expect(page.locator('.comment[data-depth="0"]').first()).toBeVisible();
    await expect(page.locator('.comments__total')).toHaveText('12,483 Comments');

    // ---- Expand a thread → replies render ----
    await page.locator('[data-thread-anchor="UgxFixtureManyReplies0003"]').click();
    await expect(page.locator('.comment[data-depth="1"]').first()).toBeVisible();
    expect(await monoOffenders(page, '.comments')).toEqual([]);

    // ---- WatchMeta channel link → channel route, then browser-back to watch (F4) ----
    await page.locator('a.watch__chan-name').click();
    await expect(page.locator('.channel')).toBeVisible();
    await expect(page.locator('.chan-header').getByText('Lofi Girl')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('watch-title')).toHaveText(
      'Lofi Hip Hop Radio — beats to relax/study to',
    );

    // ---- Forward into the channel again to sweep its tabs ----
    await page.locator('a.watch__chan-name').click();
    await expect(page.locator('.channel')).toBeVisible();
    await expect(page.locator('.channel .card').first()).toBeVisible();

    // ---- Videos tab paginates to page 2 ----
    const chLoadMore = page.locator('.channel__more').getByRole('button', { name: 'Load more' });
    await chLoadMore.click();
    await expect(page.getByText('Lofi Radio 3')).toBeVisible();
    await expect(chLoadMore).toHaveCount(0);

    // ---- Playlists tab ----
    await page.getByRole('tab', { name: 'Playlists' }).click();
    await expect(page.getByText('Study Mixes')).toBeVisible();
    expect(await monoOffenders(page, '.channel')).toEqual([]);

    // ---- Back to Home → "Continue watching" holds the video just visited ----
    await page.evaluate(() => {
      window.location.hash = '#/';
    });
    await expect(page.locator('.home')).toBeVisible();
    const continueShelf = page.locator('.home__shelf', { hasText: 'Continue watching' });
    await expect(continueShelf).toBeVisible();
    await expect(
      continueShelf.getByText('Lofi Hip Hop Radio — beats to relax/study to'),
    ).toBeVisible();
    expect(await monoOffenders(page, '.home')).toEqual([]);

    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
