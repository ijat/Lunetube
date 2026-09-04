import { describe, expect, it } from 'vitest';
import { FakeYouTubeSource } from '../fake/FakeYouTubeSource.js';
import type { StreamPrefs } from '@lunetube/shared';

const PREFS: StreamPrefs = { maxHeight: 'auto', preferredAudioLanguage: null, audioOnly: false };
const src = new FakeYouTubeSource();

describe('FakeYouTubeSource — the seam CI runs against', () => {
  it('getVideo returns a mapped VideoDetail by id', async () => {
    const res = await src.getVideo({ videoId: 'LXb3EKWsInQ' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.title).toContain('Costa Rica');
      expect(res.value.chapters).toHaveLength(4);
    }
  });

  it('getVideo can also be addressed by fixture stem', async () => {
    const res = await src.getVideo({ videoId: 'video-live' });
    expect(res.ok && res.value.isLive).toBe(true);
  });

  it('getVideo errors for an unknown id', async () => {
    const res = await src.getVideo({ videoId: 'doesnotexist' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('YT_UNAVAILABLE');
  });

  it('getStreams builds a DASH manifest whose media URLs are proxy-rewritten', async () => {
    const proxied = new FakeYouTubeSource({
      rewriters: {
        media: (u) =>
          new URL(`http://127.0.0.1:7000/t/media?u=${encodeURIComponent(u.toString())}`),
      },
    });
    const res = await proxied.getStreams({ videoId: 'LXb3EKWsInQ', prefs: PREFS });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.kind).toBe('dash');
      expect(res.value.video[0]?.height).toBe(2160);
      expect(res.value.video.every((t) => t.url.includes('127.0.0.1:7000'))).toBe(true);
      expect(res.value.durationSec).toBe(621);
      expect(res.value.expiresAt).toBe(Date.parse('2026-09-03T05:00:00.000Z'));
      expect(res.value.captions).toHaveLength(2);
    }
  });

  it('getStreams surfaces YT_UNAVAILABLE when streaming_data is missing (degradation case)', async () => {
    const res = await src.getStreams({ videoId: 'video-no-streaming', prefs: PREFS });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('YT_UNAVAILABLE');
  });

  // Changed in P1-3, deliberately. The fake used to synthesise a manifest for a
  // live fixture, which the InnerTube path can never do: youtubei.js' toDash()
  // throws for live videos (v18.0.0 core/mixins/MediaInfo.js). A fake that
  // succeeds where the real adapter fails is a false green — the whole point of
  // it is that CI exercises the same strategy the app runs.
  it('getStreams refuses a live video, exactly as the InnerTube path does', async () => {
    const res = await src.getStreams({ videoId: 'liveStream1', prefs: PREFS });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('NOT_IMPLEMENTED');
      expect(res.error.message).toMatch(/live/i);
    }
  });

  it('getRelated maps the watch-next feed', async () => {
    const res = await src.getRelated({ videoId: 'LXb3EKWsInQ' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.items).toHaveLength(2);
      expect(res.value.items[0]?.id).toBe('aqz-KE-bpKQ');
    }
  });

  it('the four still-unwritten Phase-2 methods return NOT_IMPLEMENTED', async () => {
    const results = await Promise.all([
      src.getComments({ videoId: 'x', sort: 'top' }),
      src.getCommentReplies({ handle: 'h' }),
      src.getChannel({ channelId: 'x', tab: 'videos' }),
      src.getPlaylist({ playlistId: 'x' }),
    ]);
    for (const res of results) {
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('NOT_IMPLEMENTED');
    }
  });

  it('search / getSearchSuggestions / resolveUrl are implemented (P2-3)', async () => {
    expect((await src.search({ query: 'lofi' })).ok).toBe(true);
    expect((await src.getSearchSuggestions({ query: 'lofi' })).ok).toBe(true);
    const nav = await src.resolveUrl({ url: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(nav.ok && nav.value).toEqual({ kind: 'video', videoId: 'dQw4w9WgXcQ' });
  });

  it('getDiagnostics reports the fake adapter', async () => {
    await src.getStreams({ videoId: 'LXb3EKWsInQ', prefs: PREFS });
    const res = await src.getDiagnostics();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.youtubeiVersion).toBe('fake');
      expect(res.value.ladder.map((l) => l.client)).toEqual(['IOS', 'MWEB', 'WEB']);
    }
  });
});
