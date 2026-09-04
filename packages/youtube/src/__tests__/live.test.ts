/**
 * Opt-in live smoke test. Skipped unless `LUNE_LIVE=1` — **never runs in CI**
 * (GitHub datacenter IPs are bot-blocked; plan F2/R2). Run locally with:
 *
 *   LUNE_LIVE=1 pnpm vitest run packages/youtube/src/__tests__/live.test.ts
 *
 * It hits real YouTube: `getVideo` + `getStreams` for the plan's F2 test IDs,
 * and — the reason it exists — proves against the real generator that a
 * manifest resolved through proxy rewriters contains **no** upstream URL.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JSDOM, type XmlElement } from 'jsdom';
import { InnertubeYouTubeSource } from '../innertube/source.js';
import { identityRewriter } from '../contract.js';

const LIVE = process.env['LUNE_LIVE'] === '1';
const IDS = ['LXb3EKWsInQ', 'aqz-KE-bpKQ'];
/** 4K/60, plan F2. Verified 2026-09-04: 34 formats, all with URLs, no captions. */
const UHD_ID = 'LXb3EKWsInQ';
/**
 * A video that actually has caption tracks. Verified 2026-09-04 that the `IOS`
 * client returns six for it, while both 4K test videos above return **none** —
 * so caption routing has to be asserted against this one or the assertion is
 * vacuous.
 */
const CAPTIONED_ID = 'dQw4w9WgXcQ';

const DOMParser = new JSDOM().window.DOMParser;

const route =
  (name: string) =>
  (url: URL): URL =>
    new URL(`http://127.0.0.1:5599/tok/${name}?u=${encodeURIComponent(url.toString())}`);

describe.skipIf(!LIVE)('live YouTube (LUNE_LIVE=1)', () => {
  const cacheDir = (): string => mkdtempSync(join(tmpdir(), 'lunetube-live-'));
  const source = new InnertubeYouTubeSource({
    cacheDir: cacheDir(),
    rewriters: { media: identityRewriter },
  });

  it.each(IDS)(
    'getVideo(%s) succeeds',
    async (id) => {
      const res = await source.getVideo({ videoId: id });
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.title.length).toBeGreaterThan(0);
    },
    30_000,
  );

  it.each(IDS)(
    'getStreams(%s) resolves adaptive formats',
    async (id) => {
      const res = await source.getStreams({
        videoId: id,
        prefs: { maxHeight: 'auto', preferredAudioLanguage: null, audioOnly: false },
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.video.length).toBeGreaterThan(0);
        expect(res.value.audio.length).toBeGreaterThan(0);
        expect(res.value.manifestXml).toContain('<MPD');
      }
    },
    30_000,
  );

  it(`getStreams(${UHD_ID}) offers a real 2160p entry and expires in the future`, async () => {
    const res = await source.getStreams({
      videoId: UHD_ID,
      prefs: { maxHeight: 'auto', preferredAudioLanguage: null, audioOnly: false },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.video.some((track) => track.height === 2160)).toBe(true);
    expect(res.value.client).toBe('IOS');
    expect(res.value.expiresAt).toBeGreaterThan(Date.now());
    expect(res.value.storyboards.length).toBeGreaterThan(0);
  }, 30_000);

  it('search("lofi") returns rich result cards (catches a LockupView mapper regression)', async () => {
    const res = await source.search({ query: 'lofi' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.items.length).toBeGreaterThanOrEqual(10);
    const rich = res.value.items.filter((item) => {
      const view =
        item.kind === 'video'
          ? { title: item.video.title, thumb: item.video.thumbnailUrl }
          : item.kind === 'playlist'
            ? { title: item.playlist.title, thumb: item.playlist.thumbnailUrl }
            : { title: item.channel.name, thumb: item.channel.avatarUrl };
      return view.title.length > 0 && view.thumb != null;
    });
    expect(rich.length).toBeGreaterThanOrEqual(8);
  }, 30_000);

  it('getSearchSuggestions("lofi") returns at least one suggestion', async () => {
    const res = await source.getSearchSuggestions({ query: 'lofi' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.length).toBeGreaterThanOrEqual(1);
      expect(res.value.every((s) => typeof s === 'string' && s.length > 0)).toBe(true);
    }
  }, 30_000);

  it('getChannel(<real UC id>) returns rich videos + about content', async () => {
    const resolved = await source.resolveUrl({ url: 'https://www.youtube.com/@veritasium' });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok || resolved.value.kind !== 'channel') return;
    const channelId = resolved.value.channelId;

    const videos = await source.getChannel({ channelId, tab: 'videos' });
    expect(videos.ok).toBe(true);
    if (videos.ok) {
      expect(videos.value.content.kind).toBe('videos');
      if (videos.value.content.kind === 'videos') {
        expect(videos.value.content.items.length).toBeGreaterThanOrEqual(10);
      }
      expect(videos.value.channel?.availableTabs.length).toBeGreaterThan(0);
    }

    const about = await source.getChannel({ channelId, tab: 'about' });
    expect(about.ok).toBe(true);
    if (about.ok) {
      expect(about.value.content.kind).toBe('about');
      if (about.value.content.kind === 'about') {
        expect(about.value.content.about.description.length).toBeGreaterThan(0);
      }
    }
  }, 30_000);

  it('getPlaylist(<real public uploads playlist>) paginates to the end without error', async () => {
    const resolved = await source.resolveUrl({ url: 'https://www.youtube.com/@veritasium' });
    if (!resolved.ok || resolved.value.kind !== 'channel') {
      throw new Error('could not resolve a real channel id to build an uploads playlist id');
    }
    // The standard "uploads" playlist for any channel: UC… → UU… (same suffix).
    const uploadsId = `UU${resolved.value.channelId.slice(2)}`;

    let last = await source.getPlaylist({ playlistId: uploadsId });
    expect(last.ok).toBe(true);
    let hops = 0;
    // A long-running channel's uploads playlist can run to many hundreds of
    // pages; this is a manual/local-only smoke test (never runs in CI), so the
    // cap exists only to guarantee termination, not to bound runtime tightly.
    while (last.ok && last.value.continuation != null && hops < 300) {
      last = await source.getPlaylist({
        playlistId: uploadsId,
        continuation: last.value.continuation,
      });
      hops += 1;
      expect(last.ok).toBe(true);
    }
    // Empirically (2026-09-04, this channel): youtubei.js' `Playlist.has_continuation`
    // flips false exactly on the true last page, so the *end-of-list throw*
    // (P2-F6 #3 — `mapPlaylistDetail`/`getPlaylist` catching
    // 'Got empty continuation response…' and returning `items: []`) is not
    // reached for every playlist; it is deterministically pinned instead by
    // the mocked-`getContinuation` unit tests in `playlist.test.ts`. What this
    // live test verifies is that real pagination completes without error and
    // terminates (`continuation: undefined`), whichever ending YouTube gives us.
    expect(last.ok).toBe(true);
    if (last.ok) expect(last.value.continuation).toBeUndefined();
  }, 600_000);

  it('resolveUrl(@handle) resolves to a channel id over the network', async () => {
    const res = await source.resolveUrl({ url: 'https://www.youtube.com/@veritasium' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.kind).toBe('channel');
      if (res.value.kind === 'channel') expect(res.value.channelId).toMatch(/^UC[\w-]{22}$/);
    }
  }, 30_000);

  it('routes every URL of a real manifest through the proxy, media and captions alike', async () => {
    const proxied = new InnertubeYouTubeSource({
      cacheDir: cacheDir(),
      rewriters: { media: route('media'), image: route('img'), caption: route('caption') },
    });
    const res = await proxied.getStreams({
      videoId: CAPTIONED_ID,
      prefs: { maxHeight: 'auto', preferredAudioLanguage: null, audioOnly: false },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.captions.length).toBeGreaterThan(0);
    for (const caption of res.value.captions) {
      expect(caption.url).toContain('/tok/caption?u=');
    }

    const doc = new DOMParser().parseFromString(res.value.manifestXml, 'application/xml');
    expect(Array.from<XmlElement>(doc.getElementsByTagName('parsererror'))).toHaveLength(0);

    const urls: string[] = [];
    for (const el of Array.from<XmlElement>(doc.getElementsByTagName('*'))) {
      if (el.tagName === 'BaseURL' && (el.textContent ?? '').trim().length > 0) {
        urls.push((el.textContent ?? '').trim());
      }
      for (const name of ['initialization', 'media', 'sourceURL', 'index']) {
        const value = el.getAttribute(name);
        if (value != null && /^https?:\/\//.test(value)) urls.push(value);
      }
    }
    expect(urls.length).toBeGreaterThan(5);
    for (const url of urls) expect(new URL(url).hostname).toBe('127.0.0.1');
    expect(urls.some((u) => u.includes('/tok/caption?'))).toBe(true);
    expect(res.value.manifestXml).not.toMatch(/>\s*https:\/\/[^<]*googlevideo\.com/);

    const diag = await proxied.getDiagnostics();
    expect(diag.ok).toBe(true);
    if (diag.ok) {
      expect(diag.value.lastClient).toBe('IOS');
      expect(diag.value.lastExpiresAt).toBe(res.value.expiresAt);
    }
  }, 60_000);
});
