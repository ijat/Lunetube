import { describe, expect, it } from 'vitest';
import { mapAuthorRef, mapChannelCard, mapPlaylistRef } from '../innertube/map/cards.js';

const rewrite = (url: URL): URL =>
  new URL(`http://127.0.0.1:5599/tok/img?u=${encodeURIComponent(url.toString())}`);

describe('mapPlaylistRef', () => {
  const cases: { name: string; node: unknown; expected: unknown }[] = [
    {
      name: 'Playlist',
      node: {
        type: 'Playlist',
        id: 'PL123',
        title: { text: 'Best of 2026' },
        thumbnails: [{ url: 'https://i.ytimg.com/pl.jpg', width: 480, height: 270 }],
        video_count: { text: '42 videos' },
        video_count_short: { text: '42' },
      },
      expected: {
        id: 'PL123',
        title: 'Best of 2026',
        thumbnailUrl: 'https://i.ytimg.com/pl.jpg',
        videoCount: 42,
      },
    },
    {
      name: 'GridPlaylist',
      node: {
        type: 'GridPlaylist',
        id: 'PLgrid',
        title: { text: 'Grid list' },
        thumbnails: [{ url: 'https://i.ytimg.com/g.jpg', width: 360, height: 202 }],
        video_count_short: { text: '1.2K' },
      },
      expected: {
        id: 'PLgrid',
        title: 'Grid list',
        thumbnailUrl: 'https://i.ytimg.com/g.jpg',
        videoCount: 1200,
      },
    },
    {
      name: 'LockupView + PLAYLIST',
      node: {
        type: 'LockupView',
        content_type: 'PLAYLIST',
        content_id: 'PLlockup',
        metadata: { title: { text: 'Lockup playlist' } },
        content_image: {
          primary_thumbnail: {
            image: [{ url: 'https://i.ytimg.com/lp.jpg', width: 480, height: 270 }],
          },
        },
      },
      expected: {
        id: 'PLlockup',
        title: 'Lockup playlist',
        thumbnailUrl: 'https://i.ytimg.com/lp.jpg',
        videoCount: null,
      },
    },
  ];

  for (const { name, node, expected } of cases) {
    it(`maps ${name}`, () => {
      expect(mapPlaylistRef(node as never)).toEqual(expected);
    });
  }

  it('returns null when there is no playlist id', () => {
    expect(mapPlaylistRef({ type: 'Playlist', title: { text: 'x' } } as never)).toBeNull();
  });

  it('degrades to a partial DTO when every optional field is absent', () => {
    expect(mapPlaylistRef({ type: 'GridPlaylist', id: 'PLbare' } as never)).toEqual({
      id: 'PLbare',
      title: '',
      thumbnailUrl: null,
      videoCount: null,
    });
  });

  it('routes the thumbnail through an injected rewriter', () => {
    const ref = mapPlaylistRef(
      {
        type: 'Playlist',
        id: 'PL1',
        thumbnails: [{ url: 'https://i.ytimg.com/pl.jpg', width: 480, height: 270 }],
      } as never,
      rewrite,
    );
    expect(ref?.thumbnailUrl).toContain('127.0.0.1:5599/tok/img?u=');
  });
});

describe('mapChannelCard', () => {
  it('maps Channel', () => {
    const detail = mapChannelCard({
      type: 'Channel',
      id: 'UCabc',
      author: {
        id: 'UCabc',
        name: 'Some Creator',
        thumbnails: [{ url: 'https://yt3.ggpht.com/a.jpg', width: 176, height: 176 }],
        is_verified: true,
      },
      subscriber_count: { text: '1.2M subscribers' },
      video_count: { text: '345 videos' },
      description_snippet: { text: 'We make things.' },
    } as never);

    expect(detail).toEqual({
      id: 'UCabc',
      name: 'Some Creator',
      avatarUrl: 'https://yt3.ggpht.com/a.jpg',
      handle: null,
      subscriberText: '1.2M subscribers',
      bannerUrl: null,
      description: 'We make things.',
      videoCount: 345,
      isVerified: true,
      availableTabs: [],
    });
  });

  it('maps GridChannel (subscribers field, no description)', () => {
    const detail = mapChannelCard({
      type: 'GridChannel',
      id: 'UCgrid',
      author: { id: 'UCgrid', name: 'Grid Chan', thumbnails: [] },
      subscribers: { text: '900K' },
      video_count: { text: '12' },
    } as never);

    expect(detail).toMatchObject({
      id: 'UCgrid',
      name: 'Grid Chan',
      subscriberText: '900K',
      videoCount: 12,
      description: '',
      isVerified: false,
    });
  });

  it('maps LockupView + CHANNEL (name/avatar from lockup fields)', () => {
    const detail = mapChannelCard({
      type: 'LockupView',
      content_type: 'CHANNEL',
      content_id: 'UClockup',
      metadata: { title: { text: 'Lockup Chan' } },
      content_image: {
        primary_thumbnail: {
          image: [{ url: 'https://yt3.ggpht.com/l.jpg', width: 160, height: 160 }],
        },
      },
    } as never);

    expect(detail).toMatchObject({
      id: 'UClockup',
      name: 'Lockup Chan',
      avatarUrl: 'https://yt3.ggpht.com/l.jpg',
    });
  });

  it('returns null when there is no channel id', () => {
    expect(mapChannelCard({ type: 'Channel', author: { name: 'x' } } as never)).toBeNull();
  });

  it('degrades to a partial DTO when every optional field is absent', () => {
    expect(mapChannelCard({ type: 'GridChannel', id: 'UCbare' } as never)).toEqual({
      id: 'UCbare',
      name: '',
      avatarUrl: null,
      handle: null,
      subscriberText: null,
      bannerUrl: null,
      description: '',
      videoCount: null,
      isVerified: false,
      availableTabs: [],
    });
  });
});

describe('mapAuthorRef', () => {
  it('maps a youtubei.js Author', () => {
    expect(
      mapAuthorRef({
        id: 'UC1',
        name: 'Author Name',
        thumbnails: [{ url: 'https://yt3.ggpht.com/av.jpg', width: 88, height: 88 }],
      }),
    ).toEqual({
      id: 'UC1',
      name: 'Author Name',
      avatarUrl: 'https://yt3.ggpht.com/av.jpg',
    });
  });

  it('never throws on null / empty', () => {
    expect(mapAuthorRef(null)).toEqual({ id: '', name: '', avatarUrl: null });
    expect(mapAuthorRef({})).toEqual({ id: '', name: '', avatarUrl: null });
  });

  it('routes the avatar through an injected rewriter', () => {
    const ref = mapAuthorRef(
      { id: 'UC1', name: 'A', thumbnails: [{ url: 'https://yt3.ggpht.com/av.jpg', width: 88 }] },
      rewrite,
    );
    expect(ref.avatarUrl).toContain('127.0.0.1:5599/tok/img?u=');
  });
});
