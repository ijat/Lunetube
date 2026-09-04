import { describe, expect, it, vi } from 'vitest';
import type { SearchFilters } from '@lunetube/shared';
import { DEFAULT_SEARCH_FILTERS } from '@lunetube/shared';
import { mapSearchPage, toInnertubeFilters, type RawSearch } from '../innertube/map/search.js';
import { InnertubeYouTubeSource, type InnertubeYouTubeSourceOptions } from '../innertube/source.js';
import { FakeYouTubeSource } from '../fake/FakeYouTubeSource.js';
import { identityRewriter } from '../contract.js';

const REWRITERS = { media: identityRewriter };

function filters(patch: Partial<SearchFilters>): SearchFilters {
  return { ...DEFAULT_SEARCH_FILTERS, ...patch };
}

// ---------------------------------------------------------------------------
// toInnertubeFilters — the P2-F3 / A14 translation table
// ---------------------------------------------------------------------------

describe('toInnertubeFilters', () => {
  it('maps sort → prioritize', () => {
    expect(toInnertubeFilters(filters({ sort: 'views' })).prioritize).toBe('popularity');
    expect(toInnertubeFilters(filters({ sort: 'relevance' })).prioritize).toBe('relevance');
  });

  it("omits the key entirely for an 'any' / 'all' selection (never sends 'all')", () => {
    const out = toInnertubeFilters(DEFAULT_SEARCH_FILTERS);
    expect(out).not.toHaveProperty('upload_date');
    expect(out).not.toHaveProperty('duration');
    expect(out).not.toHaveProperty('type');
    // whatever it does emit, it is never the string 'all'
    expect(Object.values(out)).not.toContain('all');
  });

  it('maps uploadDate when not "any"', () => {
    expect(toInnertubeFilters(filters({ uploadDate: 'today' })).upload_date).toBe('today');
    expect(toInnertubeFilters(filters({ uploadDate: 'week' })).upload_date).toBe('week');
    expect(toInnertubeFilters(filters({ uploadDate: 'month' })).upload_date).toBe('month');
    expect(toInnertubeFilters(filters({ uploadDate: 'year' })).upload_date).toBe('year');
    expect(toInnertubeFilters(filters({ uploadDate: 'any' }))).not.toHaveProperty('upload_date');
  });

  it('maps duration short/medium/long → InnerTube proto names', () => {
    expect(toInnertubeFilters(filters({ duration: 'short' })).duration).toBe('under_three_mins');
    expect(toInnertubeFilters(filters({ duration: 'medium' })).duration).toBe(
      'three_to_twenty_mins',
    );
    expect(toInnertubeFilters(filters({ duration: 'long' })).duration).toBe('over_twenty_mins');
    expect(toInnertubeFilters(filters({ duration: 'any' }))).not.toHaveProperty('duration');
  });

  it('maps type video/channel/playlist, omits "all"', () => {
    expect(toInnertubeFilters(filters({ type: 'video' })).type).toBe('video');
    expect(toInnertubeFilters(filters({ type: 'channel' })).type).toBe('channel');
    expect(toInnertubeFilters(filters({ type: 'playlist' })).type).toBe('playlist');
    expect(toInnertubeFilters(filters({ type: 'all' }))).not.toHaveProperty('type');
  });
});

// ---------------------------------------------------------------------------
// mapSearchPage — per-kind dispatch, unknown nodes, shelves
// ---------------------------------------------------------------------------

const videoNode = {
  type: 'Video',
  video_id: 'vid00000001',
  title: { text: 'A Video' },
  thumbnails: [{ url: 'https://i.ytimg.com/vi/vid/hq.jpg', width: 480, height: 360 }],
  author: { id: 'UC0000000000000000000001', name: 'Uploader' },
  short_view_count: { text: '1.5M views' },
};
const channelNode = {
  type: 'Channel',
  id: 'UC0000000000000000000002',
  author: { id: 'UC0000000000000000000002', name: 'A Channel', is_verified: true },
  subscriber_count: { text: '900K subscribers' },
};
const playlistNode = {
  type: 'GridPlaylist',
  id: 'PLxxxxxxxxxx',
  title: { text: 'A Playlist' },
  video_count_short: { text: '20' },
};

describe('mapSearchPage', () => {
  it('dispatches each SearchResultItem kind', () => {
    const search: RawSearch = {
      results: [videoNode, channelNode, playlistNode],
      estimated_results: 12345,
    };
    const { items, estimatedResults } = mapSearchPage(search);
    expect(estimatedResults).toBe(12345);
    expect(items.map((i) => i.kind)).toEqual(['video', 'channel', 'playlist']);
    expect(items[0]).toMatchObject({ kind: 'video', video: { id: 'vid00000001' } });
    expect(items[1]).toMatchObject({
      kind: 'channel',
      channel: { id: 'UC0000000000000000000002' },
    });
    expect(items[2]).toMatchObject({ kind: 'playlist', playlist: { id: 'PLxxxxxxxxxx' } });
  });

  it('classifies a LockupView by content_type', () => {
    const lv = (content_type: string, id: string): unknown => ({
      type: 'LockupView',
      content_type,
      content_id: id,
      metadata: { title: { text: `lockup ${content_type}` } },
    });
    const { items } = mapSearchPage({
      results: [
        lv('VIDEO', 'lvvideo0001'),
        lv('PLAYLIST', 'PLlv1'),
        lv('CHANNEL', 'UClvchannelxxxxxxxxxxxxx'),
      ],
    });
    expect(items.map((i) => i.kind)).toEqual(['video', 'playlist', 'channel']);
  });

  it('skips unknown node types instead of throwing', () => {
    const { items } = mapSearchPage({
      results: [{ type: 'AdSlot' }, videoNode, { type: 'SomethingBrandNew', foo: 1 }, null, 'x'],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('video');
  });

  it('flattens a shelf one level and skips a shelf it cannot flatten', () => {
    const { items } = mapSearchPage({
      results: [
        { type: 'Shelf', content: { items: [videoNode, channelNode] } },
        { type: 'ReelShelf', items: [{ type: 'ShortsLockupView', entity_id: 'shorty12345' }] },
        { type: 'RichShelf', contents: [{ content: playlistNode }] },
        { type: 'Shelf' },
      ],
    });
    expect(items.map((i) => i.kind)).toEqual(['video', 'channel', 'video', 'playlist']);
  });

  it('returns null estimatedResults when absent', () => {
    expect(mapSearchPage({ results: [] }).estimatedResults).toBeNull();
  });

  it('degrades a node with no resolvable id to a skip, not a throw', () => {
    const { items } = mapSearchPage({ results: [{ type: 'Video' }, { type: 'Channel' }] });
    expect(items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// InnertubeYouTubeSource.search — first page, continuation, guards
// ---------------------------------------------------------------------------

function sourceWith(yt: Record<string, unknown>): InnertubeYouTubeSource {
  return new InnertubeYouTubeSource({
    cacheDir: '',
    rewriters: REWRITERS,
    createInnertube: (() =>
      Promise.resolve(yt)) as unknown as InnertubeYouTubeSourceOptions['createInnertube'],
  });
}

describe('InnertubeYouTubeSource.search', () => {
  it('maps a first page and mints a continuation when has_continuation', async () => {
    const page2 = { results: [videoNode], estimated_results: 5, has_continuation: false };
    const page1 = {
      results: [videoNode, channelNode],
      estimated_results: 5,
      has_continuation: true,
      getContinuation: vi.fn(() => Promise.resolve(page2)),
    };
    const search = vi.fn(() => Promise.resolve(page1));
    const src = sourceWith({ search });

    const first = await src.search({ query: '  lofi  ', filters: DEFAULT_SEARCH_FILTERS });
    expect(search).toHaveBeenCalledWith(
      'lofi',
      expect.objectContaining({ prioritize: 'relevance' }),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.items).toHaveLength(2);
    const handle = first.value.continuation;
    expect(handle).toMatch(/^search:/);
    if (handle == null) return;

    const second = await src.search({ query: 'lofi', continuation: handle });
    expect(page1.getContinuation).toHaveBeenCalledTimes(1);
    expect(second.ok && second.value.items).toHaveLength(1);
    expect(second.ok && second.value.continuation).toBeUndefined();
  });

  it('does not send filters to yt.search when none are given', async () => {
    const search = vi.fn(() => Promise.resolve({ results: [], has_continuation: false }));
    await sourceWith({ search }).search({ query: 'x-ray' });
    expect(search).toHaveBeenCalledWith('x-ray', undefined);
  });

  it('rejects an empty or over-long query with INVALID_INPUT and no network call', async () => {
    const search = vi.fn();
    const src = sourceWith({ search });
    for (const query of ['', '   ', 'q'.repeat(257)]) {
      const res = await src.search({ query });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('INVALID_INPUT');
    }
    expect(search).not.toHaveBeenCalled();
  });

  it('rejects an unknown / expired continuation handle with INVALID_INPUT', async () => {
    const res = await sourceWith({ search: vi.fn() }).search({
      query: 'lofi',
      continuation: 'search:deadbeef',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INVALID_INPUT');
  });
});

// ---------------------------------------------------------------------------
// FakeYouTubeSource.search — fixtures + page 2
// ---------------------------------------------------------------------------

describe('FakeYouTubeSource.search', () => {
  const fake = new FakeYouTubeSource();

  it('serves search-basic for a bare query and its page 2 via the continuation', async () => {
    const first = await fake.search({ query: 'lofi' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.items.map((i) => i.kind)).toEqual([
      'video',
      'video',
      'video',
      'channel',
      'playlist',
      'video',
    ]);
    expect(first.value.estimatedResults).toBe(1000000);
    const cont = first.value.continuation;
    expect(cont).toBe('search-page2');
    if (cont == null) return;

    const second = await fake.search({ query: 'lofi', continuation: cont });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.items).toHaveLength(2);
    expect(second.value.continuation).toBeUndefined();
  });

  it('matches a filtered search by its composite key', async () => {
    const res = await fake.search({
      query: 'lofi',
      filters: { sort: 'views', uploadDate: 'month', duration: 'short', type: 'video' },
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.items).toHaveLength(2);
  });

  it('errors for a query with no fixture', async () => {
    const res = await fake.search({ query: 'no-such-fixture-query' });
    expect(res.ok).toBe(false);
  });
});
