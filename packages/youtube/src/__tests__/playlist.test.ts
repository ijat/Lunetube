import { describe, expect, it, vi } from 'vitest';
import { mapPlaylistDetail } from '../innertube/map/playlist.js';
import { InnertubeYouTubeSource, type InnertubeYouTubeSourceOptions } from '../innertube/source.js';
import { FakeYouTubeSource } from '../fake/FakeYouTubeSource.js';
import { identityRewriter } from '../contract.js';

const REWRITERS = { media: identityRewriter };

function sourceWith(yt: Record<string, unknown>): InnertubeYouTubeSource {
  return new InnertubeYouTubeSource({
    cacheDir: '',
    rewriters: REWRITERS,
    createInnertube: (() =>
      Promise.resolve(yt)) as unknown as InnertubeYouTubeSourceOptions['createInnertube'],
  });
}

const videoNode = {
  type: 'PlaylistVideo',
  video_id: 'plvid0000001',
  title: { text: 'Track 1' },
  short_view_count: { text: '100K views' },
  length_text: { text: '3:00' },
};

// ---------------------------------------------------------------------------
// mapPlaylistDetail
// ---------------------------------------------------------------------------

describe('mapPlaylistDetail', () => {
  it('maps a full first page', () => {
    const pl = {
      info: {
        title: 'Study Mix',
        description: 'A collection of focus tracks.',
        author: { id: 'UC1111111111111111111111', name: 'Lofi Girl', thumbnails: [] },
        thumbnails: [{ url: 'https://i.ytimg.com/vi/vid1/hq.jpg', width: 480, height: 360 }],
        total_items: '48',
        views: '1,234,567 views',
        last_updated: 'Updated yesterday',
      },
      items: [videoNode],
    };
    const detail = mapPlaylistDetail(pl, 'PLbasic00000000000000000001');
    expect(detail).toEqual({
      id: 'PLbasic00000000000000000001',
      title: 'Study Mix',
      thumbnailUrl: 'https://i.ytimg.com/vi/vid1/hq.jpg',
      videoCount: 48,
      description: 'A collection of focus tracks.',
      author: { id: 'UC1111111111111111111111', name: 'Lofi Girl', avatarUrl: null },
      lastUpdatedText: 'Updated yesterday',
      items: [expect.objectContaining({ id: 'plvid0000001', title: 'Track 1' })],
    });
  });

  it('degrades a continuation response (no header) to empty/null header fields, keeping items', () => {
    const pl = { videos: [videoNode] };
    const detail = mapPlaylistDetail(pl, 'PLbasic00000000000000000001');
    expect(detail).toEqual({
      id: 'PLbasic00000000000000000001',
      title: '',
      thumbnailUrl: null,
      videoCount: null,
      description: '',
      author: null,
      lastUpdatedText: null,
      items: [expect.objectContaining({ id: 'plvid0000001' })],
    });
  });

  it("treats the literal 'N/A' stat placeholder as absent", () => {
    const pl = { info: { total_items: 'N/A', views: 'N/A', last_updated: 'N/A' }, items: [] };
    const detail = mapPlaylistDetail(pl, 'PL1');
    expect(detail.videoCount).toBeNull();
    expect(detail.lastUpdatedText).toBeNull();
  });

  it('falls back to `videos` when reading `items` throws (ParsingError, P2-F6 #4)', () => {
    const pl = {
      info: { title: 'Mix' },
      get items(): never {
        throw new Error('ParsingError: unknown node type');
      },
      videos: [videoNode],
    };
    expect(() => mapPlaylistDetail(pl, 'PL1')).not.toThrow();
    const detail = mapPlaylistDetail(pl, 'PL1');
    expect(detail.items).toEqual([expect.objectContaining({ id: 'plvid0000001' })]);
  });
});

// ---------------------------------------------------------------------------
// InnertubeYouTubeSource.getPlaylist
// ---------------------------------------------------------------------------

describe('InnertubeYouTubeSource.getPlaylist', () => {
  it('rejects an invalid playlist id with no network call', async () => {
    const getPlaylist = vi.fn();
    const res = await sourceWith({ getPlaylist }).getPlaylist({ playlistId: '!' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INVALID_INPUT');
    expect(getPlaylist).not.toHaveBeenCalled();
  });

  it('maps a first page and mints a continuation when has_continuation', async () => {
    const pl = { has_continuation: true, info: { title: 'Study Mix' }, items: [videoNode] };
    const getPlaylist = vi.fn(() => Promise.resolve(pl));
    const res = await sourceWith({ getPlaylist }).getPlaylist({
      playlistId: 'PLbasic00000000000000000001',
    });
    expect(getPlaylist).toHaveBeenCalledWith('PLbasic00000000000000000001');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.title).toBe('Study Mix');
    expect(res.value.continuation).toMatch(/^playlist:/);
  });

  it('does not mint a continuation when there are no more pages', async () => {
    const pl = { has_continuation: false, info: { title: 'Study Mix' }, items: [] };
    const res = await sourceWith({ getPlaylist: () => Promise.resolve(pl) }).getPlaylist({
      playlistId: 'PLbasic00000000000000000001',
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.continuation).toBeUndefined();
  });

  it('paginates a continuation handle via getContinuation()', async () => {
    const page2 = { has_continuation: false, videos: [{ ...videoNode, video_id: 'plvid0000002' }] };
    const page1 = {
      has_continuation: true,
      info: { title: 'Study Mix' },
      items: [videoNode],
      getContinuation: vi.fn(() => Promise.resolve(page2)),
    };
    const src = sourceWith({ getPlaylist: () => Promise.resolve(page1) });

    const first = await src.getPlaylist({ playlistId: 'PLbasic00000000000000000001' });
    const handle = first.ok ? first.value.continuation : undefined;
    expect(handle).toMatch(/^playlist:/);
    if (handle == null) return;

    const second = await src.getPlaylist({
      playlistId: 'PLbasic00000000000000000001',
      continuation: handle,
    });
    expect(page1.getContinuation).toHaveBeenCalledTimes(1);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.title).toBe(''); // continuation page carries no header
    expect(second.value.items).toEqual([expect.objectContaining({ id: 'plvid0000002' })]);
    expect(second.value.continuation).toBeUndefined();
  });

  it('rejects a stale/unknown continuation handle with INVALID_INPUT', async () => {
    const res = await sourceWith({}).getPlaylist({
      playlistId: 'PLbasic00000000000000000001',
      continuation: 'playlist:deadbeef',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INVALID_INPUT');
  });

  it("catches the Playlist constructor's end-of-list throw and returns an empty ok page, not an error", async () => {
    const page1 = {
      has_continuation: true,
      info: { title: 'Study Mix' },
      items: [videoNode],
      getContinuation: vi.fn(() =>
        Promise.reject(
          new Error('Got empty continuation response. This is likely the end of the playlist.'),
        ),
      ),
    };
    const src = sourceWith({ getPlaylist: () => Promise.resolve(page1) });

    const first = await src.getPlaylist({ playlistId: 'PLbasic00000000000000000001' });
    const handle = first.ok ? first.value.continuation : undefined;
    if (handle == null) throw new Error('expected a continuation handle');

    const last = await src.getPlaylist({
      playlistId: 'PLbasic00000000000000000001',
      continuation: handle,
    });
    expect(last.ok).toBe(true);
    if (last.ok) {
      expect(last.value.items).toEqual([]);
      expect(last.value.continuation).toBeUndefined();
    }
  });

  it('lets an unrelated InnertubeError through as a real error (not swallowed by the end-of-list catch)', async () => {
    const page1 = {
      has_continuation: true,
      info: { title: 'Study Mix' },
      items: [videoNode],
      getContinuation: vi.fn(() => Promise.reject(new Error('This playlist is private'))),
    };
    const src = sourceWith({ getPlaylist: () => Promise.resolve(page1) });
    const first = await src.getPlaylist({ playlistId: 'PLbasic00000000000000000001' });
    const handle = first.ok ? first.value.continuation : undefined;
    if (handle == null) throw new Error('expected a continuation handle');

    const res = await src.getPlaylist({
      playlistId: 'PLbasic00000000000000000001',
      continuation: handle,
    });
    expect(res.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FakeYouTubeSource.getPlaylist — fixtures + page 2 + the end-of-list fixture
// ---------------------------------------------------------------------------

describe('FakeYouTubeSource.getPlaylist', () => {
  const fake = new FakeYouTubeSource();

  it('serves playlist-basic, its page 2, and the final empty end-of-list page', async () => {
    const first = await fake.getPlaylist({ playlistId: 'PLbasic00000000000000000001' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.title).toBe('Study Mix');
    expect(first.value.items).toHaveLength(2);
    const cont1 = first.value.continuation;
    expect(cont1).toBe('playlist-page2');
    if (cont1 == null) return;

    const second = await fake.getPlaylist({
      playlistId: 'PLbasic00000000000000000001',
      continuation: cont1,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.items).toHaveLength(1);
    const cont2 = second.value.continuation;
    expect(cont2).toBe('playlist-end');
    if (cont2 == null) return;

    const third = await fake.getPlaylist({
      playlistId: 'PLbasic00000000000000000001',
      continuation: cont2,
    });
    expect(third.ok).toBe(true);
    if (third.ok) {
      expect(third.value.items).toEqual([]);
      expect(third.value.continuation).toBeUndefined();
    }
  });

  it('errors for a playlist id with no fixture', async () => {
    const res = await fake.getPlaylist({ playlistId: 'PLdoes-not-exist-anywhere-0001' });
    expect(res.ok).toBe(false);
  });
});
