import { describe, expect, it } from 'vitest';
import { mapChannelRef, mapFeedVideos, mapVideoDetail } from '../innertube/map/video.js';
import { loadVideoFixture } from '../fake/fixtures.js';

describe('mapVideoDetail (video-normal)', () => {
  const detail = mapVideoDetail(loadVideoFixture('video-normal'));

  it('maps the core fields', () => {
    expect(detail).not.toBeNull();
    expect(detail?.id).toBe('LXb3EKWsInQ');
    expect(detail?.title).toContain('Costa Rica');
    expect(detail?.durationSec).toBe(621);
    expect(detail?.viewCount).toBe(44_100_000);
    expect(detail?.likeCount).toBe(512_000);
    expect(detail?.isLive).toBe(false);
    expect(detail?.category).toBe('Travel & Events');
    expect(detail?.keywords).toEqual(['4k', 'costa rica', 'nature', 'hdr']);
  });

  it('resolves the channel with an avatar capped at 176px', () => {
    expect(detail?.channel).toMatchObject({
      id: 'UCabc1234567890Channel',
      name: 'Jacob + Katie Schwarz',
    });
    expect(detail?.channel.avatarUrl).toBe('https://yt3.ggpht.com/ytc/avatar_s176.jpg');
  });

  it('prefers the richer secondary_info description and finds its timestamps', () => {
    expect(detail?.description).toContain('drone segment');
    expect(detail?.descriptionTimestamps.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it('takes chapters from the decorated player bar', () => {
    expect(detail?.chapters.map((c) => c.title)).toEqual([
      'Introduction',
      'Rainforest',
      'Beaches',
      'Wildlife',
    ]);
    expect(detail?.chapters[0]?.source).toBe('youtube');
    expect(detail?.chapters[3]?.endSec).toBe(621);
  });

  it('exposes most-replayed peaks', () => {
    expect(detail?.mostReplayed).toHaveLength(3);
    expect(detail?.mostReplayed[0]).toEqual({ positionSec: 0, intensity: 1 });
  });

  it('picks the video thumbnail', () => {
    expect(detail?.thumbnailUrl).toBe('https://i.ytimg.com/vi/LXb3EKWsInQ/maxresdefault.jpg');
  });
});

describe('mapVideoDetail image rewriter (P1-6: /img proxy for CSP + canvas)', () => {
  const rewrite = (url: URL): URL =>
    new URL(`http://127.0.0.1:5599/tok/img?u=${encodeURIComponent(url.toString())}`);
  const detail = mapVideoDetail(loadVideoFixture('video-normal'), rewrite);

  it('routes the video thumbnail through the injected rewriter', () => {
    expect(detail?.thumbnailUrl).toBe(
      'http://127.0.0.1:5599/tok/img?u=' +
        encodeURIComponent('https://i.ytimg.com/vi/LXb3EKWsInQ/maxresdefault.jpg'),
    );
  });

  it('routes the channel avatar through the injected rewriter', () => {
    expect(detail?.channel.avatarUrl).toBe(
      'http://127.0.0.1:5599/tok/img?u=' +
        encodeURIComponent('https://yt3.ggpht.com/ytc/avatar_s176.jpg'),
    );
  });

  it('rewrites related-feed thumbnails and avatars too', () => {
    const items = mapFeedVideos(loadVideoFixture('video-normal').watch_next_feed, rewrite);
    for (const item of items) {
      if (item.thumbnailUrl != null)
        expect(item.thumbnailUrl).toContain('127.0.0.1:5599/tok/img?u=');
      if (item.channel.avatarUrl != null)
        expect(item.channel.avatarUrl).toContain('127.0.0.1:5599/tok/img?u=');
    }
  });
});

describe('mapVideoDetail degradation', () => {
  it('returns null when there is no video id', () => {
    expect(mapVideoDetail({ basic_info: { title: 'x' } })).toBeNull();
    expect(mapVideoDetail({})).toBeNull();
  });

  it('handles a video with no description / chapters / heat map', () => {
    const detail = mapVideoDetail(loadVideoFixture('video-no-description'));
    expect(detail?.description).toBe('');
    expect(detail?.descriptionTimestamps).toEqual([]);
    expect(detail?.chapters).toEqual([]);
    expect(detail?.mostReplayed).toEqual([]);
    expect(detail?.likeCount).toBeNull();
    expect(detail?.category).toBeNull();
    expect(detail?.thumbnailUrl).toBeNull();
  });

  it('handles a live video', () => {
    const detail = mapVideoDetail(loadVideoFixture('video-live'));
    expect(detail?.isLive).toBe(true);
    expect(detail?.durationSec).toBe(0);
    expect(detail?.chapters).toEqual([]);
  });
});

describe('mapChannelRef fallbacks', () => {
  it('falls back to basic_info.author then secondary owner', () => {
    expect(mapChannelRef({ basic_info: { author: 'Just Author' } }).name).toBe('Just Author');
    expect(
      mapChannelRef({ secondary_info: { owner: { author: { id: 'UC1', name: 'Owner Name' } } } }),
    ).toMatchObject({ id: 'UC1', name: 'Owner Name' });
  });

  it('never throws on an empty object', () => {
    expect(mapChannelRef({})).toEqual({ id: '', name: '', avatarUrl: null });
  });
});

describe('mapFeedVideos (watch_next_feed)', () => {
  const items = mapFeedVideos(loadVideoFixture('video-normal').watch_next_feed);

  it('maps related items with parsed durations and view counts', () => {
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: 'aqz-KE-bpKQ',
      title: expect.stringContaining('Big Buck Bunny'),
    });
    expect(items[0]?.durationSec).toBe(634);
    expect(items[0]?.viewCount).toBe(8_400_000);
    expect(items[1]?.durationSec).toBe(10_800);
  });

  it('returns [] for a missing feed', () => {
    expect(mapFeedVideos(undefined)).toEqual([]);
    expect(mapFeedVideos([{ title: 'no id' }])).toEqual([]);
  });
});
