import { describe, expect, it } from 'vitest';
import {
  mapChannelRef,
  mapFeedVideo,
  mapFeedVideos,
  mapVideoDetail,
} from '../innertube/map/video.js';
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

describe('mapFeedVideo node dispatch (P2-F5)', () => {
  const rewrite = (url: URL): URL =>
    new URL(`http://127.0.0.1:5599/tok/img?u=${encodeURIComponent(url.toString())}`);

  it('maps a LockupView (VIDEO)', () => {
    const node = {
      type: 'LockupView',
      content_type: 'VIDEO',
      content_id: 'vid123',
      metadata: {
        title: { text: 'A Lockup Video' },
        metadata: {
          metadata_rows: [
            {
              metadata_parts: [
                {
                  text: { text: 'Creator Name' },
                  avatar_stack: {
                    avatars: [
                      { image: [{ url: 'https://yt3.ggpht.com/av.jpg', width: 48, height: 48 }] },
                    ],
                  },
                },
              ],
            },
            {
              metadata_parts: [{ text: { text: '1.2M views' } }, { text: { text: '3 days ago' } }],
            },
          ],
        },
      },
      content_image: {
        image: [{ url: 'https://i.ytimg.com/vi/vid123/hq.jpg', width: 480, height: 270 }],
        overlays: [{ badges: [{ text: '12:34' }] }],
      },
    };

    expect(mapFeedVideo(node)).toEqual({
      id: 'vid123',
      title: 'A Lockup Video',
      channel: { id: '', name: 'Creator Name', avatarUrl: 'https://yt3.ggpht.com/av.jpg' },
      durationSec: 754,
      thumbnailUrl: 'https://i.ytimg.com/vi/vid123/hq.jpg',
      publishedText: '3 days ago',
      viewCount: 1_200_000,
      isLive: false,
    });
  });

  it('finds the view count by shape, not by position', () => {
    const node = {
      type: 'LockupView',
      content_type: 'VIDEO',
      content_id: 'reordered',
      metadata: {
        title: { text: 'x' },
        metadata: {
          metadata_rows: [
            {
              metadata_parts: [{ text: { text: '5 years ago' } }, { text: { text: '900K views' } }],
            },
          ],
        },
      },
    };
    expect(mapFeedVideo(node)).toMatchObject({ viewCount: 900_000, publishedText: '5 years ago' });
  });

  it('reads a LIVE badge from the LockupView overlay', () => {
    const node = {
      type: 'LockupView',
      content_type: 'VIDEO',
      content_id: 'liveid',
      metadata: { title: { text: 'Live now' } },
      content_image: {
        overlays: [{ badges: [{ badge_style: 'THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE' }] }],
      },
    };
    expect(mapFeedVideo(node)).toMatchObject({ isLive: true, durationSec: null });
  });

  it('maps a LockupView (SHORT)', () => {
    const node = {
      type: 'LockupView',
      content_type: 'SHORT',
      content_id: 'shrt1',
      metadata: { title: { text: 'A short' } },
    };
    expect(mapFeedVideo(node)).toMatchObject({ id: 'shrt1', title: 'A short', isLive: false });
  });

  it('skips a LockupView that is a playlist or a channel', () => {
    expect(
      mapFeedVideo({ type: 'LockupView', content_type: 'PLAYLIST', content_id: 'PL1' }),
    ).toBeNull();
    expect(
      mapFeedVideo({ type: 'LockupView', content_type: 'CHANNEL', content_id: 'UC1' }),
    ).toBeNull();
    // content_type absent → also skipped (cannot prove it is a video)
    expect(mapFeedVideo({ type: 'LockupView', content_id: 'x' })).toBeNull();
  });

  it('degrades a LockupView to a partial DTO when every optional field is absent', () => {
    expect(
      mapFeedVideo({ type: 'LockupView', content_type: 'VIDEO', content_id: 'bare1' }),
    ).toEqual({
      id: 'bare1',
      title: '',
      channel: { id: '', name: '', avatarUrl: null },
      durationSec: null,
      thumbnailUrl: null,
      publishedText: null,
      viewCount: null,
      isLive: false,
    });
  });

  it('maps a ShortsLockupView', () => {
    const node = {
      type: 'ShortsLockupView',
      entity_id: 'shortEntity',
      on_tap_endpoint: { payload: { videoId: 'short123' } },
      overlay_metadata: {
        primary_text: { text: 'My Short' },
        secondary_text: { text: '4.5M views' },
      },
      thumbnail: [{ url: 'https://i.ytimg.com/short.jpg', width: 405, height: 720 }],
    };
    expect(mapFeedVideo(node, rewrite)).toEqual({
      id: 'short123',
      title: 'My Short',
      channel: { id: '', name: '', avatarUrl: null },
      durationSec: null,
      thumbnailUrl:
        'http://127.0.0.1:5599/tok/img?u=' + encodeURIComponent('https://i.ytimg.com/short.jpg'),
      publishedText: null,
      viewCount: 4_500_000,
      isLive: false,
    });
  });

  it('falls back to entity_id when a ShortsLockupView has no endpoint videoId', () => {
    expect(mapFeedVideo({ type: 'ShortsLockupView', entity_id: 'e1' })).toMatchObject({
      id: 'e1',
      title: '',
      viewCount: null,
    });
  });

  it('returns null for a ShortsLockupView with no resolvable id', () => {
    expect(mapFeedVideo({ type: 'ShortsLockupView' })).toBeNull();
  });

  it('maps a GridVideo (views / duration on their own fields)', () => {
    const node = {
      type: 'GridVideo',
      video_id: 'gv1',
      title: { text: 'Grid vid' },
      thumbnails: [{ url: 'https://i.ytimg.com/gv.jpg', width: 480, height: 360 }],
      views: { text: '1,234 views' },
      duration: { text: '10:30' },
      published: { text: '2 days ago' },
      author: { id: 'UCg', name: 'Grid Chan', thumbnails: [] },
    };
    expect(mapFeedVideo(node)).toEqual({
      id: 'gv1',
      title: 'Grid vid',
      channel: { id: 'UCg', name: 'Grid Chan', avatarUrl: null },
      durationSec: 630,
      thumbnailUrl: 'https://i.ytimg.com/gv.jpg',
      publishedText: '2 days ago',
      viewCount: 1234,
      isLive: false,
    });
  });

  it('maps a ReelItem (views field)', () => {
    const node = {
      type: 'ReelItem',
      id: 'reel1',
      title: { text: 'Reel' },
      thumbnails: [{ url: 'https://i.ytimg.com/r.jpg', width: 405, height: 720 }],
      views: { text: '500K views' },
    };
    expect(mapFeedVideo(node)).toMatchObject({
      id: 'reel1',
      title: 'Reel',
      viewCount: 500_000,
      durationSec: null,
    });
  });

  it('degrades GridVideo / ReelItem to a partial DTO with no optional fields', () => {
    expect(mapFeedVideo({ type: 'GridVideo', video_id: 'gvbare' })).toEqual({
      id: 'gvbare',
      title: '',
      channel: { id: '', name: '', avatarUrl: null },
      durationSec: null,
      thumbnailUrl: null,
      publishedText: null,
      viewCount: null,
      isLive: false,
    });
    expect(mapFeedVideo({ type: 'ReelItem', id: 'rbare' })).toMatchObject({
      id: 'rbare',
      title: '',
      viewCount: null,
    });
  });
});
