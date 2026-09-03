import { describe, expect, it, vi } from 'vitest';
import { JSDOM, type XmlDocument, type XmlElement } from 'jsdom';
import type { StreamPrefs } from '@lunetube/shared';
import {
  mapAudioTracks,
  mapCaptionTracks,
  mapStoryboards,
  mapVideoTracks,
  parseMimeType,
  partitionAdaptiveFormats,
  resolveExpiresAt,
  DEFAULT_STREAM_TTL_MS,
} from '../innertube/map/streams.js';
import { ClassicDashStrategy, classifyManifestUrl } from '../playback/classicDash.js';
import type { DashRequest, PlaybackContext, PlaybackInfo } from '../playback/strategy.js';
import { InnertubeYouTubeSource, type InnertubeYouTubeSourceOptions } from '../innertube/source.js';
import { FakeYouTubeSource } from '../fake/FakeYouTubeSource.js';
import { loadVideoFixture } from '../fake/fixtures.js';

const proxy = (u: URL): URL =>
  new URL(`http://127.0.0.1:5599/tok/media?u=${encodeURIComponent(u.toString())}`);

/** Distinct rewriters per route, so a misrouted URL is visible in an assertion. */
const route =
  (name: 'media' | 'img' | 'caption') =>
  (u: URL): URL =>
    new URL(`http://127.0.0.1:5599/tok/${name}?u=${encodeURIComponent(u.toString())}`);

const REWRITERS = { media: route('media'), image: route('img'), caption: route('caption') };

const PREFS: StreamPrefs = { maxHeight: 'auto', preferredAudioLanguage: null, audioOnly: false };

describe('parseMimeType', () => {
  it('splits container and codec', () => {
    expect(parseMimeType('video/mp4; codecs="av01.0.12M.08"')).toEqual({
      container: 'video/mp4',
      codec: 'av01.0.12M.08',
    });
    expect(parseMimeType('audio/webm; codecs="opus"')).toEqual({
      container: 'audio/webm',
      codec: 'opus',
    });
    expect(parseMimeType(undefined)).toEqual({ container: '', codec: '' });
  });
});

describe('adaptive format mapping (video-normal fixture)', () => {
  const fixture = loadVideoFixture('video-normal');
  const formats = fixture.streaming_data?.adaptive_formats ?? [];

  it('partitions video and audio', () => {
    const { video, audio } = partitionAdaptiveFormats(formats);
    expect(video).toHaveLength(3);
    expect(audio).toHaveLength(2);
  });

  it('maps video tracks, sorted by height desc, URLs rewritten to the proxy', () => {
    const tracks = mapVideoTracks(formats, proxy);
    expect(tracks.map((t) => t.height)).toEqual([2160, 1080, 360]);
    expect(tracks[0]?.codec).toBe('av01.0.12M.08');
    expect(tracks[0]?.fps).toBe(60);
    for (const t of tracks) {
      expect(t.url.startsWith('http://127.0.0.1:5599/tok/media?u=')).toBe(true);
      expect(t.url).not.toContain('googlevideo.com/videoplayback?expire');
    }
  });

  it('maps audio tracks and flags the default track', () => {
    const tracks = mapAudioTracks(formats, proxy);
    expect(tracks).toHaveLength(2);
    const def = tracks.find((t) => t.isDefault);
    expect(def?.sampleRate).toBe(44100);
    expect(tracks.find((t) => t.language === 'es')?.isDefault).toBe(false);
  });

  it('drops formats with no URL', () => {
    const tracks = mapVideoTracks(
      [{ mime_type: 'video/mp4; codecs="avc1"', width: 1920, height: 1080 }],
      proxy,
    );
    expect(tracks).toEqual([]);
  });

  it('maps caption tracks, distinguishing asr from standard', () => {
    const captions = mapCaptionTracks(fixture.captions, (u) => u);
    expect(captions).toHaveLength(2);
    expect(captions[0]).toMatchObject({ languageCode: 'en', label: 'English', kind: 'standard' });
    expect(captions[1]?.kind).toBe('asr');
  });

  it('maps storyboards (3 levels) with dimensions', () => {
    const boards = mapStoryboards(fixture.storyboards, (u) => u);
    expect(boards).toHaveLength(3);
    expect(boards[0]).toMatchObject({
      level: 0,
      thumbnailWidth: 48,
      thumbnailHeight: 27,
      columns: 10,
      rows: 10,
    });
    expect(boards[2]?.intervalMs).toBe(2000);
  });
});

describe('degradation', () => {
  it('returns [] for missing streaming data / captions / storyboards', () => {
    expect(mapVideoTracks(undefined, proxy)).toEqual([]);
    expect(mapAudioTracks(null, proxy)).toEqual([]);
    expect(mapCaptionTracks(undefined, (u) => u)).toEqual([]);
    expect(mapCaptionTracks({ caption_tracks: null }, (u) => u)).toEqual([]);
    expect(mapStoryboards(undefined, (u) => u)).toEqual([]);
  });

  it('keeps the original URL when the rewriter throws', () => {
    const tracks = mapVideoTracks(
      [
        {
          url: 'https://x.googlevideo.com/v?a=1',
          mime_type: 'video/mp4; codecs="avc1"',
          width: 1,
          height: 1,
          has_video: true,
        },
      ],
      () => {
        throw new Error('boom');
      },
    );
    expect(tracks[0]?.url).toBe('https://x.googlevideo.com/v?a=1');
  });
});

// ---------------------------------------------------------------------------
// P1-3: expiry
// ---------------------------------------------------------------------------

describe('resolveExpiresAt', () => {
  const url = (expire: string): string =>
    `https://rr3---sn-x.googlevideo.com/videoplayback?expire=${expire}&itag=140`;

  it('reads the expire query parameter (unix seconds) off a raw googlevideo URL', () => {
    expect(resolveExpiresAt({ formats: [{ url: url('1788462000') }] })).toBe(1788462000000);
  });

  it('falls back to now + 5h when nothing declares an expiry', () => {
    const now = (): number => 1_000_000;
    expect(resolveExpiresAt({ formats: [{ url: 'https://x.googlevideo.com/v' }], now })).toBe(
      1_000_000 + DEFAULT_STREAM_TTL_MS,
    );
    expect(DEFAULT_STREAM_TTL_MS).toBe(5 * 60 * 60 * 1000);
    expect(resolveExpiresAt({ now })).toBe(1_000_000 + DEFAULT_STREAM_TTL_MS);
    expect(resolveExpiresAt({ streamingData: {}, formats: [], now })).toBe(
      1_000_000 + DEFAULT_STREAM_TTL_MS,
    );
  });

  it('takes the earliest signal — an early re-resolve is cheap, a late one is a 403 storm', () => {
    const early = Date.parse('2026-09-03T05:00:00.000Z');
    expect(
      resolveExpiresAt({
        streamingData: { expires: '2026-09-03T05:00:00.000Z' },
        formats: [{ url: url('1788462000') }, { url: url('1788470000') }],
      }),
    ).toBe(early);
    // …and the URL wins when it is the earlier of the two.
    expect(
      resolveExpiresAt({
        streamingData: { expires: new Date('2026-09-04T00:00:00.000Z') },
        formats: [{ url: url('1788462000') }],
      }),
    ).toBe(1788462000000);
  });

  it('ignores unusable expiry signals rather than producing NaN', () => {
    const now = (): number => 5_000;
    expect(
      resolveExpiresAt({
        streamingData: { expires: 'not-a-date' },
        formats: [{ url: 'not a url' }, { url: url('nope') }, { url: url('0') }, {}],
        now,
      }),
    ).toBe(5_000 + DEFAULT_STREAM_TTL_MS);
  });

  it('cannot read an expiry back out of a proxy-rewritten URL — hence raw formats only', () => {
    const rewritten = route('media')(new URL(url('1788462000'))).toString();
    const now = (): number => 7_000;
    expect(resolveExpiresAt({ formats: [{ url: rewritten }], now })).toBe(
      7_000 + DEFAULT_STREAM_TTL_MS,
    );
  });
});

// ---------------------------------------------------------------------------
// P1-3: per-route URL classification
// ---------------------------------------------------------------------------

describe('classifyManifestUrl', () => {
  const kind = (u: string): string => classifyManifestUrl(new URL(u));

  it('routes googlevideo media, timedtext captions and ytimg storyboards apart', () => {
    expect(kind('https://rr3---sn-4g5e6nez.googlevideo.com/videoplayback?itag=140')).toBe('media');
    expect(kind('https://www.youtube.com/api/timedtext?v=x&lang=en&fmt=vtt')).toBe('caption');
    expect(kind('https://i.ytimg.com/sb/x/storyboard3_L2/M0.jpg')).toBe('image');
    expect(kind('https://yt3.ggpht.com/a/avatar=s88')).toBe('image');
  });

  it('matches hosts anchored, so a lookalike host is not treated as media', () => {
    expect(kind('https://googlevideo.com.evil.example/x')).toBe('media'); // default, not a match
    expect(kind('https://evil.example/?u=.googlevideo.com')).toBe('media');
    // The point of the assertion above: neither is *recognised*; both fall to
    // the default route, where the proxy's own allow-list rejects them.
    expect(kind('https://i.ytimg.com.evil.example/sb/x.jpg')).toBe('media');
  });
});

// ---------------------------------------------------------------------------
// P1-3: ClassicDashStrategy over fixture data
// ---------------------------------------------------------------------------

/**
 * jsdom supplies a real `DOMParser` (this test project runs in the node
 * environment), so "the manifest is well-formed XML" is checked by an XML
 * parser rather than by a regex that would happily accept
 * `<MPD><Period></MPD>`. jsdom reports a malformed document as a
 * `<parsererror>` root.
 */
const DOMParser = new JSDOM().window.DOMParser;

/** Every URL the manifest would make the renderer fetch. */
function manifestUrls(xml: string): string[] {
  const doc = parseManifest(xml);
  const urls: string[] = [];
  for (const el of Array.from<XmlElement>(doc.getElementsByTagName('*'))) {
    if (el.tagName === 'BaseURL') {
      const text = el.textContent?.trim() ?? '';
      if (text.length > 0) urls.push(text);
    }
    // The URL-bearing DASH attributes (`xsi:schemaLocation` names an XML
    // schema and is not fetched, so it is not one of them).
    for (const name of ['initialization', 'media', 'sourceURL', 'index']) {
      const value = el.getAttribute(name);
      if (value != null && /^https?:\/\//.test(value)) urls.push(value);
    }
  }
  return urls;
}

function parseManifest(xml: string): XmlDocument {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  expect(Array.from<XmlElement>(doc.getElementsByTagName('parsererror'))).toHaveLength(0);
  return doc;
}

describe('ClassicDashStrategy — the proxy invariant', () => {
  const streams = async (): Promise<{
    manifestXml: string;
    video: { url: string }[];
    audio: { url: string }[];
    captions: { url: string }[];
    storyboards: { url: string }[];
    expiresAt: number;
    client: string;
    durationSec: number;
  }> => {
    const res = await new FakeYouTubeSource({ rewriters: REWRITERS }).getStreams({
      videoId: 'LXb3EKWsInQ',
      prefs: PREFS,
    });
    if (!res.ok)
      throw new Error(`expected a manifest, got ${res.error.code}: ${res.error.message}`);
    return res.value;
  };

  it('emits a well-formed manifest with one AdaptationSet per format and caption track', async () => {
    const doc = parseManifest((await streams()).manifestXml);
    expect(doc.documentElement.tagName).toBe('MPD');
    // 3 video + 2 audio formats + 2 caption tracks in video-normal.json.
    expect(Array.from<XmlElement>(doc.getElementsByTagName('AdaptationSet'))).toHaveLength(7);
    expect(
      Array.from<XmlElement>(doc.getElementsByTagName('AdaptationSet')).filter(
        (el) => el.getAttribute('contentType') === 'text',
      ),
    ).toHaveLength(2);
  });

  it('points every manifest URL at the loopback proxy and none at an upstream host', async () => {
    const urls = manifestUrls((await streams()).manifestXml);
    expect(urls.length).toBeGreaterThanOrEqual(7);
    for (const raw of urls) {
      expect(new URL(raw).hostname).toBe('127.0.0.1');
    }
  });

  it('leaves no unencoded upstream URL anywhere in the manifest text', async () => {
    const xml = (await streams()).manifestXml;
    // An upstream URL may only appear percent-encoded inside a `?u=` payload;
    // never as element text or as a bare attribute value.
    expect(xml).not.toMatch(/>\s*https:\/\/[^<]*(googlevideo\.com|ytimg\.com|youtube\.com)/);
    expect(xml).not.toMatch(/="https:\/\/[^"]*(googlevideo\.com|ytimg\.com|youtube\.com)/);
  });

  it('sends each URL through the rewriter for its own proxy route', async () => {
    const manifest = await streams();
    const urls = manifestUrls(manifest.manifestXml);
    const media = urls.filter((u) => u.includes('/tok/media?'));
    const caption = urls.filter((u) => u.includes('/tok/caption?'));
    expect(media).toHaveLength(5);
    expect(caption).toHaveLength(2);
    // The failure this guards against: youtubei.js pushes timedtext URLs through
    // the same url_transformer as media, so a media-only rewriter would emit
    // /media?u=<timedtext>, which the proxy's host allow-list rejects.
    for (const url of caption) {
      expect(decodeURIComponent(new URL(url).searchParams.get('u') ?? '')).toContain(
        '/api/timedtext',
      );
    }
    for (const url of media) {
      expect(decodeURIComponent(new URL(url).searchParams.get('u') ?? '')).toContain(
        'googlevideo.com',
      );
    }
  });

  it('routes the DTO track, caption and storyboard URLs the same way', async () => {
    const manifest = await streams();
    for (const track of [...manifest.video, ...manifest.audio]) {
      expect(track.url).toContain('/tok/media?u=');
    }
    for (const caption of manifest.captions) {
      expect(caption.url).toContain('/tok/caption?u=');
    }
    expect(manifest.storyboards).toHaveLength(3);
    for (const board of manifest.storyboards) {
      expect(board.url).toContain('/tok/img?u=');
    }
  });

  it('carries the client, duration and an expiry taken from the raw URLs', async () => {
    const manifest = await streams();
    expect(manifest.client).toBe('IOS');
    expect(manifest.durationSec).toBe(621);
    expect(manifest.expiresAt).toBe(Date.parse('2026-09-03T05:00:00.000Z'));
  });
});

describe('ClassicDashStrategy — failure modes', () => {
  const fixture = loadVideoFixture('video-normal');
  const ctx = (over: Partial<PlaybackContext> = {}): PlaybackContext => ({
    client: 'IOS',
    prefs: PREFS,
    rewriteMedia: REWRITERS.media,
    rewriteImage: REWRITERS.image,
    rewriteCaption: REWRITERS.caption,
    ...over,
  });
  const info = (over: Partial<PlaybackInfo> = {}): PlaybackInfo => ({
    ...fixture,
    toDash: () => Promise.resolve('<MPD></MPD>'),
    ...over,
  });

  it('refuses a live stream up front instead of letting toDash throw', async () => {
    const toDash = vi.fn((_options?: DashRequest) => Promise.resolve('<MPD></MPD>'));
    const res = await new ClassicDashStrategy().resolve(
      info({ basic_info: { ...fixture.basic_info, is_live: true }, toDash }),
      ctx(),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('NOT_IMPLEMENTED');
      expect(res.error.retryable).toBe(false);
      expect(res.error.hint).toMatch(/live/i);
    }
    expect(toDash).not.toHaveBeenCalled();
  });

  it('reports a client that returned no usable formats, naming the client', async () => {
    const res = await new ClassicDashStrategy().resolve(
      info({ streaming_data: { adaptive_formats: [] } }),
      ctx({ client: 'MWEB' }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('YT_UNAVAILABLE');
      expect(res.error.message).toContain('MWEB');
      expect(res.error.detail).toBe('client:MWEB');
    }
  });

  it('maps a toDash throw through the injected error mapper', async () => {
    const mapError = vi.fn(() => ({
      code: 'YT_NETWORK' as const,
      message: 'mapped',
      retryable: true,
    }));
    const res = await new ClassicDashStrategy().resolve(
      info({
        toDash: () => Promise.reject(new Error('boom')),
      }),
      ctx({ mapError }),
    );
    expect(mapError).toHaveBeenCalledOnce();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('YT_NETWORK');
  });

  it('falls back to YT_PARSE_CHANGED with no mapper, and rejects a non-manifest', async () => {
    const thrown = await new ClassicDashStrategy().resolve(
      info({ toDash: () => Promise.reject(new Error('boom')) }),
      ctx(),
    );
    expect(thrown.ok).toBe(false);
    if (!thrown.ok) expect(thrown.error.code).toBe('YT_PARSE_CHANGED');

    const junk = await new ClassicDashStrategy().resolve(
      info({ toDash: () => Promise.resolve('<html>nope</html>') }),
      ctx(),
    );
    expect(junk.ok).toBe(false);
    if (!junk.ok) expect(junk.error.code).toBe('YT_PARSE_CHANGED');
  });

  it('does not filter the manifest by prefs — quality restriction is the player’s job', async () => {
    const toDash = vi.fn((_options?: DashRequest) => Promise.resolve('<MPD/>'));
    const res = await new ClassicDashStrategy().resolve(
      info({ toDash }),
      ctx({ prefs: { maxHeight: 360, preferredAudioLanguage: 'es', audioOnly: true } }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.video.map((v) => v.height)).toEqual([2160, 1080, 360]);
    expect(toDash).toHaveBeenCalledWith(
      expect.objectContaining({ manifest_options: { captions_format: 'vtt' } }),
    );
  });

  it('derives expiry from the raw format URLs, not the rewritten ones', async () => {
    // No `expires` on streaming_data, so the `expire=` query parameter on the
    // raw googlevideo URLs is the *only* signal. Reading it off the rewritten
    // track URLs instead would silently degrade to the now + 5h fallback.
    const res = await new ClassicDashStrategy().resolve(
      info({
        streaming_data: { adaptive_formats: fixture.streaming_data?.adaptive_formats ?? [] },
      }),
      ctx({ now: () => 0 }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.expiresAt).toBe(1788462000000);
  });

  it('asks toDash for VTT captions and no thumbnails', async () => {
    const toDash = vi.fn((_options?: DashRequest) => Promise.resolve('<MPD/>'));
    await new ClassicDashStrategy().resolve(info({ toDash }), ctx());
    const options = toDash.mock.calls[0]?.[0];
    expect(options?.manifest_options).toEqual({ captions_format: 'vtt' });
    expect(options?.manifest_options).not.toHaveProperty('include_thumbnails');
  });
});

// ---------------------------------------------------------------------------
// P1-3: the client ladder, driven through InnertubeYouTubeSource
// ---------------------------------------------------------------------------

interface FakeInnertube {
  getInfo: ReturnType<typeof vi.fn>;
}

function fakeSource(getInfo: (videoId: string, opts?: { client?: string }) => unknown): {
  source: InnertubeYouTubeSource;
  yt: FakeInnertube;
} {
  const yt: FakeInnertube = { getInfo: vi.fn(getInfo) };
  const source = new InnertubeYouTubeSource({
    cacheDir: '',
    rewriters: REWRITERS,
    // The source only ever calls `getInfo` on it; a full `Innertube` is
    // neither constructible offline nor needed.
    createInnertube: (() =>
      Promise.resolve(yt)) as unknown as InnertubeYouTubeSourceOptions['createInnertube'],
  });
  return { source, yt };
}

describe('getStreams — client ladder', () => {
  const fixture = loadVideoFixture('video-normal');
  const playable = (): unknown => ({
    ...fixture,
    playability_status: { status: 'OK' },
    toDash: () => Promise.resolve('<MPD><Period/></MPD>'),
  });

  it('attempts only IOS: the other ladder entries have unmet prerequisites', async () => {
    const { source, yt } = fakeSource(() => playable());
    const res = await source.getStreams({ videoId: 'LXb3EKWsInQ', prefs: PREFS });
    expect(res.ok).toBe(true);
    expect(yt.getInfo).toHaveBeenCalledTimes(1);
    expect(yt.getInfo).toHaveBeenCalledWith('LXb3EKWsInQ', { client: 'IOS' });
  });

  it('explains every skipped ladder entry in the diagnostics, actionably', async () => {
    const { source } = fakeSource(() => playable());
    await source.getStreams({ videoId: 'LXb3EKWsInQ', prefs: PREFS });
    const diag = await source.getDiagnostics();
    expect(diag.ok).toBe(true);
    if (!diag.ok) return;

    expect(diag.value.lastClient).toBe('IOS');
    expect(diag.value.lastExpiresAt).toBe(Date.parse('2026-09-03T05:00:00.000Z'));
    expect(diag.value.youtubeiVersion).toMatch(/^\d+\.\d+\.\d+$/);

    const byClient = new Map(diag.value.ladder.map((entry) => [entry.client, entry]));
    expect(diag.value.ladder.map((e) => e.client)).toEqual(['IOS', 'MWEB', 'WEB']);
    expect(byClient.get('IOS')).toMatchObject({ ok: true, formats: 5, lastError: null });
    expect(byClient.get('MWEB')?.ok).toBe(false);
    expect(byClient.get('MWEB')?.lastError).toMatch(/Proof-of-Origin/i);
    expect(byClient.get('WEB')?.lastError).toMatch(/SABR/i);
  });

  it('explains the ladder before any stream has been resolved', async () => {
    const { source } = fakeSource(() => playable());
    const diag = await source.getDiagnostics();
    expect(diag.ok).toBe(true);
    if (!diag.ok) return;
    expect(diag.value.lastClient).toBeNull();
    expect(diag.value.lastExpiresAt).toBeNull();
    expect(diag.value.ladder.filter((e) => e.lastError !== null)).toHaveLength(2);
  });

  it('stops walking the ladder on a bot check — another client hits the same IP block', async () => {
    const { source, yt } = fakeSource(() => ({
      ...fixture,
      playability_status: {
        status: 'LOGIN_REQUIRED',
        reason: "Sign in to confirm you're not a bot",
      },
      toDash: () => Promise.resolve('<MPD/>'),
    }));
    const res = await source.getStreams({ videoId: 'LXb3EKWsInQ', prefs: PREFS });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('YT_LOGIN_REQUIRED');
      expect(res.error.hint).toMatch(/IP address/i);
    }
    expect(yt.getInfo).toHaveBeenCalledTimes(1);
  });

  it('surfaces a parser break after one session refresh + retry', async () => {
    const { source, yt } = fakeSource(() => ({
      ...fixture,
      playability_status: { status: 'OK' },
      toDash: () => Promise.reject(new Error('Cannot read property foo of undefined')),
    }));
    const res = await source.getStreams({ videoId: 'LXb3EKWsInQ', prefs: PREFS });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('YT_PARSE_CHANGED');
    // once for the first attempt, once after the player refresh
    expect(yt.getInfo).toHaveBeenCalledTimes(2);
  });

  it('rejects an id that is not a video id before touching the network', async () => {
    const { source, yt } = fakeSource(() => playable());
    const res = await source.getStreams({ videoId: 'not a video id!', prefs: PREFS });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INVALID_INPUT');
    expect(yt.getInfo).not.toHaveBeenCalled();
  });
});
