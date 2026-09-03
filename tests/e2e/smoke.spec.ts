import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';

const mainEntry = fileURLToPath(new URL('../../apps/desktop/out/main/index.js', import.meta.url));

test('Cinema shell boots, renders the top bar, and logs no console errors', async () => {
  // Isolated profile so the test never inherits or leaks persisted settings.
  const userDataDir = mkdtempSync(join(tmpdir(), 'lunetube-e2e-'));
  const app = await electron.launch({ args: [mainEntry, `--user-data-dir=${userDataDir}`] });

  try {
    const page = await app.firstWindow();

    // Attach listeners BEFORE a deterministic reload so load-time errors
    // (preload failure, CSP violation, a React render throw) are actually
    // observed — `firstWindow()` resolves after the first load has begun (F4).
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Direction-B shell chrome.
    await expect(page.locator('.stage[data-dir="b"]')).toBeVisible();
    await expect(page.locator('.topbar')).toBeVisible();
    await expect(page.locator('.topbar__search input')).toHaveCount(1);
    await expect(page.locator('.backdrop')).toBeAttached();

    // Numerals: Hanken Grotesk + tabular-nums, never a fixed-pitch face (PRD §7).
    await page.evaluate(() => {
      window.location.hash = '#/watch/smoketest';
    });
    const numerals = page.locator('.route__note.tnum');
    await expect(numerals).toBeVisible();
    const font = (await numerals.evaluate((el) => getComputedStyle(el).fontFamily)).toLowerCase();
    expect(font).toContain('hanken');
    expect(font).not.toMatch(/mono/);

    // The declared stack is not enough — prove the WOFF2 actually loaded under
    // CSP `font-src 'self'` (F14).
    const hankenLoaded = await page.evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check('16px "Hanken Grotesk"');
    });
    expect(hankenLoaded).toBe(true);

    // Live theme switcher re-tints the shell.
    await page.evaluate(() => {
      window.location.hash = '#/settings';
    });
    const readAccent = () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      );
    const accentBefore = await readAccent();
    const target = accentBefore.includes('113 247 146') ? 'Purple' : 'Green';
    await page.getByRole('tab', { name: target }).click();
    await expect.poll(readAccent).not.toBe(accentBefore);

    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
