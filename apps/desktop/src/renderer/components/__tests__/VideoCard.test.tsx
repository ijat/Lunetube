import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { VideoSummary } from '@lunetube/shared';
import { VideoCard } from '../cards/VideoCard.js';

/**
 * NOTE FOR FUTURE READERS: `VirtualGrid` / `VirtualList` are deliberately NOT
 * tested in jsdom — it has no layout engine and no `ResizeObserver`, so every
 * element measures 0 and a "virtualization test" here would be vacuous. See the
 * header of `layout.test.ts` and `VirtualGrid.tsx`. Playwright covers it in
 * P2-11.
 */

const BASE: VideoSummary = {
  id: 'LXb3EKWsInQ',
  title: 'The Egg – A Short Story',
  channel: { id: 'UCsXVk37bltHxD1rDPwtNM8Q', name: 'Kurzgesagt', avatarUrl: null },
  durationSec: 754,
  thumbnailUrl: null,
  publishedText: '3 years ago',
  viewCount: 44_100_000,
  isLive: false,
};

let container: HTMLDivElement;
let root: Root;

function render(video: VideoSummary): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <VideoCard video={video} />
      </MemoryRouter>,
    );
  });
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const q = (selector: string) => container.querySelector(selector);
const text = (selector: string) => q(selector)?.textContent ?? null;

describe('VideoCard', () => {
  it('links to the watch route and names itself by its title', () => {
    render(BASE);
    const link = q('a.card') as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/watch/LXb3EKWsInQ');
    expect(text('.card__title')).toBe('The Egg – A Short Story');
  });

  it('renders the duration pill for a VOD', () => {
    render(BASE);
    expect(text('.card__badge')).toBe('12:34');
    expect(q('.card__badge--live')).toBeNull();
  });

  it('renders a LIVE badge instead of a duration for a live stream', () => {
    render({ ...BASE, isLive: true });
    const badge = q('.card__badge--live');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('LIVE');
    // A live stream's `durationSec` is meaningless — the pill must be replaced,
    // not accompanied.
    expect(container.querySelectorAll('.card__badge')).toHaveLength(1);
  });

  it('still shows a LIVE badge when the live stream reports no duration', () => {
    render({ ...BASE, isLive: true, durationSec: null });
    expect(text('.card__badge--live')).toBe('LIVE');
  });

  it('omits the pill entirely when a VOD has no duration', () => {
    render({ ...BASE, durationSec: null });
    expect(q('.card__badge')).toBeNull();
  });

  it('falls back to the gradient placeholder when the thumbnail is not proxied', () => {
    // `null` is what a card carries before the adapter has a thumbnail…
    render(BASE);
    expect(q('.card__thumb')).not.toBeNull();
    expect(q('.card__img')).toBeNull();
    expect(q('.card__av')?.tagName).toBe('SPAN');
  });

  it('refuses an upstream https thumbnail — the normal case under LUNE_FAKE_YT=1', () => {
    // The renderer CSP allows img-src 'self' data: blob: http://127.0.0.1:* only,
    // so rendering this would be a blocked request and a console error.
    render({
      ...BASE,
      thumbnailUrl: 'https://i.ytimg.com/vi/LXb3EKWsInQ/hqdefault.jpg',
      channel: { ...BASE.channel, avatarUrl: 'https://yt3.ggpht.com/a/avatar.jpg' },
    });
    expect(q('.card__img')).toBeNull();
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });

  it('renders proxied images through the loopback URL', () => {
    render({
      ...BASE,
      thumbnailUrl: 'http://127.0.0.1:51234/img?u=abc',
      channel: { ...BASE.channel, avatarUrl: 'http://127.0.0.1:51234/img?u=def' },
    });
    expect((q('.card__img') as HTMLImageElement | null)?.getAttribute('src')).toBe(
      'http://127.0.0.1:51234/img?u=abc',
    );
    expect(q('img.card__av')).not.toBeNull();
    // Decorative: the link's accessible name is the title, not a filename.
    expect((q('.card__img') as HTMLImageElement | null)?.getAttribute('alt')).toBe('');
  });

  it('puts .tnum on every numeric run and on nothing else (PRD §7)', () => {
    render(BASE);
    const tnum = [...container.querySelectorAll('.tnum')].map((el) => el.textContent);
    expect(tnum).toEqual(['12:34', '44.1M views', '3 years ago']);
    // The non-numeric channel name is NOT tabular — tabular figures are for
    // digits, applying them to prose is just wrong metrics.
    expect(q('.card__meta > span')?.classList.contains('tnum')).toBe(false);
  });

  it('omits the view-count run rather than printing 0 views', () => {
    render({ ...BASE, viewCount: null, publishedText: null });
    expect(container.querySelectorAll('.tnum')).toHaveLength(1); // the duration only
    expect(container.textContent).not.toContain('views');
  });

  it('renders no monospace family on any node (PRD §7 is locked)', () => {
    render({ ...BASE, isLive: true });
    for (const el of container.querySelectorAll<HTMLElement>('*')) {
      expect(el.style.fontFamily ?? '').not.toMatch(/mono|menlo|consolas|courier/i);
      expect(el.className.toString()).not.toMatch(/\bmono\b/i);
    }
  });

  it('declares no monospace family in cards.css either', () => {
    // jsdom does not apply stylesheets, so the DOM walk above cannot see a
    // `font-family` that comes from the sheet — and the sheet is exactly where
    // the mockup's `.vcard .d { font-family: var(--font-mono) }` would have been
    // ported from. Comments are stripped first so this file's own prose about
    // NOT using var(--font-mono) does not make the test lie.
    // Read off disk, not imported: Vitest stubs `.css` imports (including
    // `?raw`) to an empty string, and Vite rewrites the literal
    // `new URL(…, import.meta.url)` form into an asset URL that is not `file:`.
    const cssPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'cards', 'cards.css');
    const css = readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/font-family\s*:[^;}]*mono/i);
    expect(css).toMatch(/font-family\s*:\s*var\(--font-body\)/);
  });
});
