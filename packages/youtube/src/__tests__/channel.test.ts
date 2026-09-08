import { describe, expect, it, vi } from 'vitest';
import { mapAbout, mapChannelDetail, mapChannelTabContent } from '../innertube/map/channel.js';
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

// ---------------------------------------------------------------------------
// mapChannelDetail — both header shapes + degradation
// ---------------------------------------------------------------------------

describe('mapChannelDetail', () => {
  it('reads the C4TabbedHeader shape, falling back to metadata', () => {
    const ch = {
      has_videos: true,
      has_playlists: true,
      header: {
        type: 'C4TabbedHeader',
        author: {
          name: 'Lofi Girl',
          thumbnails: [{ url: 'https://yt3.ggpht.com/a.jpg', width: 176, height: 176 }],
          is_verified: true,
        },
        banner: [{ url: 'https://yt3.ggpht.com/banner.jpg', width: 1280, height: 351 }],
        subscribers: { text: '13.4M subscribers' },
        videos_count: { text: '412 videos' },
        channel_handle: { text: '@lofigirl' },
        channel_id: 'UC1111111111111111111111',
      },
      metadata: {
        external_id: 'UC1111111111111111111111',
        title: 'Lofi Girl',
        description: 'Chill beats.',
        avatar: [],
        vanity_channel_url: 'https://www.youtube.com/@lofigirl',
      },
    };
    const detail = mapChannelDetail(ch);
    expect(detail).toMatchObject({
      id: 'UC1111111111111111111111',
      name: 'Lofi Girl',
      avatarUrl: 'https://yt3.ggpht.com/a.jpg',
      handle: '@lofigirl',
      subscriberText: '13.4M subscribers',
      bannerUrl: 'https://yt3.ggpht.com/banner.jpg',
      description: 'Chill beats.',
      videoCount: 412,
      isVerified: true,
    });
    expect(detail.availableTabs.sort()).toEqual(['playlists', 'videos']);
  });

  it('reads the PageHeader → PageHeaderView shape, deriving the handle from vanity_channel_url', () => {
    const ch = {
      has_shorts: true,
      header: {
        type: 'PageHeader',
        content: {
          title: { text: { text: 'Shorts Channel' } },
          image: {
            avatar: { image: [{ url: 'https://yt3.ggpht.com/s.jpg', width: 176, height: 176 }] },
          },
          banner: { image: [{ url: 'https://yt3.ggpht.com/b.jpg', width: 1280, height: 351 }] },
          description: { description: { text: 'Bite-size video.' } },
          metadata: {
            metadata_rows: [
              {
                metadata_parts: [
                  { text: { text: '820K subscribers' } },
                  { text: { text: '120 videos' } },
                ],
              },
            ],
          },
        },
      },
      metadata: {
        external_id: 'UC2222222222222222222222',
        title: 'Shorts Channel',
        description: '',
        avatar: [],
        vanity_channel_url: 'https://www.youtube.com/@shortschannel',
      },
    };
    const detail = mapChannelDetail(ch);
    expect(detail).toMatchObject({
      id: 'UC2222222222222222222222',
      name: 'Shorts Channel',
      avatarUrl: 'https://yt3.ggpht.com/s.jpg',
      handle: '@shortschannel',
      subscriberText: '820K subscribers',
      bannerUrl: 'https://yt3.ggpht.com/b.jpg',
      description: 'Bite-size video.',
      videoCount: 120,
    });
    expect(detail.availableTabs).toEqual(['shorts']);
  });

  it('degrades to an empty-but-valid DTO when every field is missing, never throws', () => {
    expect(() => mapChannelDetail({})).not.toThrow();
    const detail = mapChannelDetail({});
    expect(detail).toEqual({
      id: '',
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

  it('treats a throwing has_* getter as tab-absent instead of throwing', () => {
    const ch = {
      get has_videos(): boolean {
        throw new Error('boom');
      },
      has_shorts: true,
    };
    expect(() => mapChannelDetail(ch)).not.toThrow();
    expect(mapChannelDetail(ch).availableTabs).toEqual(['shorts']);
  });
});

// ---------------------------------------------------------------------------
// mapAbout — both getAbout() shapes + the degraded / about-less case
// ---------------------------------------------------------------------------

describe('mapAbout', () => {
  it('reads a ChannelAboutFullMetadata shape', () => {
    const raw = {
      description: { text: 'Chill beats. Uploads daily.' },
      view_count: { text: '1.2B views' },
      joined_date: { text: 'Joined Feb 9, 2015' },
      country: { text: 'France' },
      primary_links: [
        {
          title: { text: 'lofigirl.com' },
          endpoint: { metadata: { url: 'https://lofigirl.com' } },
        },
      ],
    };
    expect(mapAbout(raw, 'fallback')).toEqual({
      description: 'Chill beats. Uploads daily.',
      joinedText: 'Joined Feb 9, 2015',
      viewCountText: '1.2B views',
      videoCountText: null,
      subscriberText: null,
      country: 'France',
      links: [{ title: 'lofigirl.com', url: 'https://lofigirl.com/' }],
    });
  });

  it('reads an AboutChannel → AboutChannelView shape', () => {
    const raw = {
      metadata: {
        description: 'Bite-size video, big ideas.',
        subscriber_count: '820K subscribers',
        view_count: '4.5M views',
        video_count: '120 videos',
        country: 'United States',
        joined_date: { text: 'Joined Mar 1, 2019' },
        links: [{ title: { text: 'Twitter' }, link: { text: 'twitter.com/shorts' } }],
      },
    };
    expect(mapAbout(raw, 'fallback')).toEqual({
      description: 'Bite-size video, big ideas.',
      joinedText: 'Joined Mar 1, 2019',
      viewCountText: '4.5M views',
      videoCountText: '120 videos',
      subscriberText: '820K subscribers',
      country: 'United States',
      links: [{ title: 'Twitter', url: 'https://twitter.com/shorts' }],
    });
  });

  it('unwraps a /redirect?q= link and re-normalises it to https (S4)', () => {
    const raw = {
      metadata: {
        description: 'Links.',
        links: [
          {
            title: { text: 'Site' },
            link: {
              text: 'redir',
              endpoint: {
                payload: {
                  url: 'https://www.youtube.com/redirect?q=https%3A%2F%2Fexample.com%2Fx',
                },
              },
            },
          },
        ],
      },
    };
    expect(mapAbout(raw, 'fallback').links).toEqual([
      { title: 'Site', url: 'https://example.com/x' },
    ]);
  });

  it('drops a link that resolves to a non-https scheme (S4)', () => {
    const raw = {
      metadata: {
        description: 'Links.',
        links: [
          {
            title: { text: 'Bad' },
            link: {
              text: 'x',
              endpoint: {
                payload: { url: 'https://www.youtube.com/redirect?q=javascript%3Aalert(1)' },
              },
            },
          },
          {
            title: { text: 'Insecure' },
            link: { text: 'x', endpoint: { payload: { url: 'http://example.com/x' } } },
          },
        ],
      },
    };
    expect(mapAbout(raw, 'fallback').links).toEqual([]);
  });

  it('degrades to the fallback description with nulls and no links when raw is null', () => {
    expect(mapAbout(null, 'A small channel with no about tab.')).toEqual({
      description: 'A small channel with no about tab.',
      joinedText: null,
      viewCountText: null,
      videoCountText: null,
      subscriberText: null,
      country: null,
      links: [],
    });
  });
});

// ---------------------------------------------------------------------------
// mapChannelTabContent
// ---------------------------------------------------------------------------

describe('mapChannelTabContent', () => {
  it('maps a videos feed', () => {
    const feed = { videos: [{ type: 'Video', video_id: 'vid00000001', title: { text: 'V1' } }] };
    const content = mapChannelTabContent('videos', feed);
    expect(content.kind).toBe('videos');
    expect(content.kind === 'videos' && content.items).toEqual([
      expect.objectContaining({ id: 'vid00000001', title: 'V1' }),
    ]);
  });

  it('maps a playlists feed', () => {
    const feed = {
      playlists: [{ type: 'GridPlaylist', id: 'PLplaylist0001', title: { text: 'Mix' } }],
    };
    const content = mapChannelTabContent('playlists', feed);
    expect(content.kind).toBe('playlists');
    expect(content.kind === 'playlists' && content.items).toEqual([
      expect.objectContaining({ id: 'PLplaylist0001', title: 'Mix' }),
    ]);
  });

  it('degrades to an empty list, never throws, when the feed is missing', () => {
    expect(mapChannelTabContent('videos', {})).toEqual({ kind: 'videos', items: [] });
    expect(mapChannelTabContent('playlists', null)).toEqual({ kind: 'playlists', items: [] });
  });
});

// ---------------------------------------------------------------------------
// InnertubeYouTubeSource.getChannel
// ---------------------------------------------------------------------------

function fakeChannel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    has_videos: true,
    has_shorts: true,
    has_playlists: true,
    has_live_streams: true,
    has_podcasts: true,
    has_about: true,
    header: {
      type: 'C4TabbedHeader',
      author: { name: 'Chan', thumbnails: [] },
      channel_id: 'UC000000000000000000000A',
    },
    metadata: {
      external_id: 'UC000000000000000000000A',
      title: 'Chan',
      description: '',
      avatar: [],
    },
    ...overrides,
  };
}

describe('InnertubeYouTubeSource.getChannel', () => {
  it('rejects an invalid channel id with no network call', async () => {
    const getChannel = vi.fn();
    const res = await sourceWith({ getChannel }).getChannel({ channelId: '!!', tab: 'videos' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INVALID_INPUT');
    expect(getChannel).not.toHaveBeenCalled();
  });

  it('resolves a first page for each of the five non-about tabs and mints a continuation', async () => {
    const tabs: ['videos' | 'shorts' | 'playlists' | 'live' | 'podcasts', string][] = [
      ['videos', 'getVideos'],
      ['shorts', 'getShorts'],
      ['playlists', 'getPlaylists'],
      ['live', 'getLiveStreams'],
      ['podcasts', 'getPodcasts'],
    ];
    for (const [tab, getter] of tabs) {
      const ch = fakeChannel({
        [getter]: vi.fn(() =>
          Promise.resolve({ has_continuation: true, videos: [], playlists: [] }),
        ),
      });
      const getChannel = vi.fn(() => Promise.resolve(ch));
      const res = await sourceWith({ getChannel }).getChannel({
        channelId: 'UC000000000000000000000A',
        tab,
      });
      expect(res.ok).toBe(true);
      if (!res.ok) continue;
      expect(res.value.channel).toBeDefined();
      expect(res.value.tab).toBe(tab);
      expect(res.value.content.kind).toBe(tab === 'playlists' ? 'playlists' : 'videos');
      expect(res.value.continuation).toMatch(/^channel:/);
    }
  });

  it('rejects a tab the channel does not have, without calling its getter', async () => {
    const getShorts = vi.fn();
    const ch = fakeChannel({ has_shorts: false, getShorts });
    const res = await sourceWith({ getChannel: () => Promise.resolve(ch) }).getChannel({
      channelId: 'UC000000000000000000000A',
      tab: 'shorts',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('YT_UNAVAILABLE');
    expect(getShorts).not.toHaveBeenCalled();
  });

  it('does not mint a continuation when the tab feed has no more pages', async () => {
    const ch = fakeChannel({
      getVideos: () => Promise.resolve({ has_continuation: false, videos: [] }),
    });
    const res = await sourceWith({ getChannel: () => Promise.resolve(ch) }).getChannel({
      channelId: 'UC000000000000000000000A',
      tab: 'videos',
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.continuation).toBeUndefined();
  });

  it('paginates a continuation handle via getContinuation(), returning no header', async () => {
    const page2 = { has_continuation: false, videos: [{ type: 'Video', video_id: 'vid00000009' }] };
    const feed1 = {
      has_continuation: true,
      videos: [],
      getContinuation: vi.fn(() => Promise.resolve(page2)),
    };
    const ch = fakeChannel({ getVideos: () => Promise.resolve(feed1) });
    const src = sourceWith({ getChannel: () => Promise.resolve(ch) });

    const first = await src.getChannel({ channelId: 'UC000000000000000000000A', tab: 'videos' });
    expect(first.ok).toBe(true);
    const handle = first.ok ? first.value.continuation : undefined;
    expect(handle).toMatch(/^channel:/);
    if (handle == null) return;

    const second = await src.getChannel({
      channelId: 'UC000000000000000000000A',
      tab: 'videos',
      continuation: handle,
    });
    expect(feed1.getContinuation).toHaveBeenCalledTimes(1);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.channel).toBeUndefined();
    expect(second.value.continuation).toBeUndefined();
    expect(second.value.content).toEqual({
      kind: 'videos',
      items: [expect.objectContaining({ id: 'vid00000009' })],
    });
  });

  it('rejects a stale/unknown continuation handle with INVALID_INPUT', async () => {
    const res = await sourceWith({}).getChannel({
      channelId: 'UC000000000000000000000A',
      tab: 'videos',
      continuation: 'channel:deadbeef',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INVALID_INPUT');
  });

  it('rejects a cross-kind continuation handle (e.g. a search handle)', async () => {
    const res = await sourceWith({}).getChannel({
      channelId: 'UC000000000000000000000A',
      tab: 'videos',
      continuation: 'search:deadbeef',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INVALID_INPUT');
  });

  describe('the about tab', () => {
    it('returns the about content and does not call a tab getter', async () => {
      const getVideos = vi.fn();
      const ch = fakeChannel({
        getAbout: () => Promise.resolve({ description: { text: 'Real about.' } }),
        getVideos,
      });
      const res = await sourceWith({ getChannel: () => Promise.resolve(ch) }).getChannel({
        channelId: 'UC000000000000000000000A',
        tab: 'about',
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.content).toEqual({
          kind: 'about',
          about: expect.objectContaining({ description: 'Real about.' }),
        });
        expect(res.value.continuation).toBeUndefined();
      }
      expect(getVideos).not.toHaveBeenCalled();
    });

    it("degrades to the channel's metadata description when getAbout() throws 'About not found'", async () => {
      const ch = fakeChannel({
        has_about: false,
        metadata: {
          external_id: 'UC000000000000000000000A',
          title: 'Chan',
          description: 'Fallback description.',
          avatar: [],
        },
        getAbout: () => Promise.reject(new Error('About not found')),
      });
      const res = await sourceWith({ getChannel: () => Promise.resolve(ch) }).getChannel({
        channelId: 'UC000000000000000000000A',
        tab: 'about',
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.content).toEqual({
          kind: 'about',
          about: expect.objectContaining({ description: 'Fallback description.', links: [] }),
        });
      }
    });
  });

  it('resolves a leading @handle via yt.resolveURL before calling yt.getChannel', async () => {
    const resolveURL = vi.fn(() =>
      Promise.resolve({ payload: { browseId: 'UC000000000000000000000A' } }),
    );
    const getChannel = vi.fn(() =>
      Promise.resolve(
        fakeChannel({ getVideos: () => Promise.resolve({ has_continuation: false, videos: [] }) }),
      ),
    );
    const res = await sourceWith({ resolveURL, getChannel }).getChannel({
      channelId: '@lofigirl',
      tab: 'videos',
    });
    expect(resolveURL).toHaveBeenCalledWith('https://www.youtube.com/@lofigirl');
    expect(getChannel).toHaveBeenCalledWith('UC000000000000000000000A');
    expect(res.ok).toBe(true);
  });

  it('reports YT_UNAVAILABLE when a handle cannot be resolved', async () => {
    const resolveURL = vi.fn(() => Promise.resolve({ payload: {} }));
    const res = await sourceWith({ resolveURL }).getChannel({
      channelId: '@nobody',
      tab: 'videos',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('YT_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// FakeYouTubeSource.getChannel — fixtures + page 2
// ---------------------------------------------------------------------------

describe('FakeYouTubeSource.getChannel', () => {
  const fake = new FakeYouTubeSource();

  it('serves the videos tab first page and its page 2 via the continuation handle', async () => {
    const first = await fake.getChannel({ channelId: 'UC1111111111111111111111', tab: 'videos' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.channel?.name).toBe('Lofi Girl');
    expect(first.value.content.kind).toBe('videos');
    const cont = first.value.continuation;
    expect(cont).toBe('channel-videos-page2');
    if (cont == null) return;

    const second = await fake.getChannel({
      channelId: 'UC1111111111111111111111',
      tab: 'videos',
      continuation: cont,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.channel).toBeUndefined();
    expect(second.value.continuation).toBeUndefined();
    expect(second.value.content.kind === 'videos' && second.value.content.items).toHaveLength(1);
  });

  it('serves each of the five non-about tabs', async () => {
    const cases: ['videos' | 'shorts' | 'playlists' | 'live' | 'podcasts', string][] = [
      ['videos', 'UC1111111111111111111111'],
      ['shorts', 'UC2222222222222222222222'],
      ['playlists', 'UC1111111111111111111111'],
      ['live', 'UC1111111111111111111111'],
      ['podcasts', 'UC1111111111111111111111'],
    ];
    for (const [tab, channelId] of cases) {
      const res = await fake.getChannel({ channelId, tab });
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.content.kind).toBe(tab === 'playlists' ? 'playlists' : 'videos');
    }
  });

  it('serves the about tab', async () => {
    const res = await fake.getChannel({ channelId: 'UC1111111111111111111111', tab: 'about' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.content.kind).toBe('about');
      expect(
        res.value.content.kind === 'about' && res.value.content.about.description.length,
      ).toBeGreaterThan(0);
    }
  });

  it('degrades an about-less channel to its metadata description', async () => {
    const res = await fake.getChannel({ channelId: 'UC3333333333333333333333', tab: 'about' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.content).toEqual({
        kind: 'about',
        about: expect.objectContaining({
          description: 'A small channel with no about tab.',
          links: [],
        }),
      });
    }
  });

  it('errors for a channel/tab with no fixture', async () => {
    const res = await fake.getChannel({ channelId: 'UC0000000000000000000000', tab: 'videos' });
    expect(res.ok).toBe(false);
  });
});
