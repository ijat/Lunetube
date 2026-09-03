/**
 * **Canary for the plan's central assumption**: that youtubei.js' *real* DASH
 * generator still behaves the way `ClassicDashStrategy` is written against.
 *
 * Everything else in the suite drives the strategy through a `toDash` stand-in,
 * which can only ever prove the strategy is self-consistent. This file runs the
 * shipped `FormatUtils.toDash` over fixture formats — offline, no `Innertube`,
 * no network — and asserts the three properties the proxy design depends on:
 *
 *  1. `toDash` accepts exactly the option object the strategy passes.
 *  2. **Every** URL it emits goes through `url_transformer`, media and caption
 *     alike. The caption case is the load-bearing one: it is why the strategy
 *     demultiplexes by host instead of handing over the media rewriter, and it
 *     is invisible in any test that stubs `toDash`.
 *  3. With `include_thumbnails` unset it emits no image AdaptationSets, so the
 *     manifest never contains an `i.ytimg.com` URL and youtubei.js never fires
 *     its storyboard-measuring HEAD requests.
 *
 * If a youtubei.js upgrade breaks any of these, this test fails with a precise
 * reason instead of the app silently losing captions in production. This file
 * is one of the four allowed to import `youtubei.js`.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM, type XmlElement } from 'jsdom';
import { FormatUtils, Misc } from 'youtubei.js';
import { loadVideoFixture } from '../../fake/fixtures.js';
import { classifyManifestUrl } from '../../playback/classicDash.js';
import type { RawFormat } from '../map/streams.js';

const DOMParser = new JSDOM().window.DOMParser;

/** snake_case fixture format → the camelCase raw shape `Format` parses. */
function rawFormatNode(format: RawFormat): Record<string, unknown> {
  const node: Record<string, unknown> = {
    itag: format.itag,
    url: format.url,
    mimeType: format.mime_type,
    bitrate: format.bitrate,
    averageBitrate: format.bitrate,
    approxDurationMs: '621000',
    contentLength: '1000000',
    indexRange: { start: '1', end: '2' },
    initRange: { start: '0', end: '0' },
    lastModified: '1700000000000000',
    quality: 'medium',
  };
  if (format.has_video === true) {
    node['width'] = format.width;
    node['height'] = format.height;
    node['fps'] = format.fps;
    // `Format` derives has_video from qualityLabel and has_audio from
    // audioQuality/audioBitrate, not from the mime type.
    node['qualityLabel'] = `${String(format.height)}p`;
  }
  if (format.has_audio === true) {
    node['audioQuality'] = 'AUDIO_QUALITY_MEDIUM';
    node['audioBitrate'] = format.bitrate;
    node['audioSampleRate'] = String(format.audio_sample_rate);
    node['audioChannels'] = format.audio_channels;
    if (format.audio_track != null) {
      node['audioTrack'] = {
        displayName: format.audio_track.display_name,
        id: format.audio_track.id,
        audioIsDefault: format.audio_track.audio_is_default,
      };
    }
  }
  return node;
}

const route =
  (name: string) =>
  (url: URL): URL =>
    new URL(`http://127.0.0.1:5599/tok/${name}?u=${encodeURIComponent(url.toString())}`);

const REWRITE = { media: route('media'), img: route('img'), caption: route('caption') };

async function generate(): Promise<{ xml: string; seen: string[] }> {
  const fixture = loadVideoFixture('video-normal');
  const formats = (fixture.streaming_data?.adaptive_formats ?? []).map(
    (format) => new Misc.Format(rawFormatNode(format) as never),
  );
  const captionTracks = (fixture.captions?.caption_tracks ?? []).map((track) => ({
    base_url: String(track.base_url),
    name: new Misc.Text({ simpleText: String(track.name) } as never),
    language_code: String(track.language_code),
    vss_id: `.${String(track.language_code)}`,
    is_translatable: true,
  }));

  const seen: string[] = [];
  // Exactly the dispatch `ClassicDashStrategy` installs.
  const transform = (url: URL): URL => {
    seen.push(url.toString());
    switch (classifyManifestUrl(url)) {
      case 'caption':
        return REWRITE.caption(url);
      case 'image':
        return REWRITE.img(url);
      default:
        return REWRITE.media(url);
    }
  };

  const xml = await FormatUtils.toDash(
    { expires: new Date(), formats: [], adaptive_formats: formats },
    false,
    transform,
    undefined,
    'test-cpn',
    undefined,
    undefined,
    // storyboards omitted — the `include_thumbnails: false` equivalent.
    undefined,
    captionTracks as never,
    { captions_format: 'vtt' },
  );
  return { xml, seen };
}

describe('youtubei.js FormatUtils.toDash (real generator, fixture formats)', () => {
  it('produces a well-formed MPD with one AdaptationSet per track group', async () => {
    const { xml } = await generate();
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(Array.from<XmlElement>(doc.getElementsByTagName('parsererror'))).toHaveLength(0);
    expect(doc.documentElement.tagName).toBe('MPD');

    const sets = Array.from<XmlElement>(doc.getElementsByTagName('AdaptationSet'));
    const byType = (type: string): number =>
      sets.filter((el) => el.getAttribute('contentType') === type).length;
    // 2 audio (one per audio track), 2 video (grouped by mime + colour info),
    // 2 text (one per caption track).
    expect(sets).toHaveLength(6);
    expect(byType('audio')).toBe(2);
    expect(byType('video')).toBe(2);
    expect(byType('text')).toBe(2);
  });

  it('sends caption URLs through the same url_transformer as media', async () => {
    const { seen } = await generate();
    expect(seen.filter((u) => u.includes('googlevideo.com'))).toHaveLength(5);
    const captions = seen.filter((u) => u.includes('/api/timedtext'));
    expect(captions).toHaveLength(2);
    // The generator appends the caption format itself, so the proxied target is
    // already the VTT one.
    for (const url of captions) expect(url).toContain('fmt=vtt');
  });

  it('leaves no URL pointing anywhere but the loopback proxy', async () => {
    const { xml } = await generate();
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const urls: string[] = [];
    for (const el of Array.from<XmlElement>(doc.getElementsByTagName('*'))) {
      if (el.tagName === 'BaseURL' && (el.textContent ?? '').length > 0) {
        urls.push((el.textContent ?? '').trim());
      }
      // The URL-bearing DASH attributes. `xsi:schemaLocation` is deliberately
      // not one of them: it names an XML schema, nothing fetches it.
      for (const name of ['initialization', 'media', 'sourceURL', 'index']) {
        const value = el.getAttribute(name);
        if (value != null && /^https?:\/\//.test(value)) urls.push(value);
      }
    }
    expect(urls).toHaveLength(7);
    for (const url of urls) expect(new URL(url).hostname).toBe('127.0.0.1');
    expect(xml).not.toMatch(/>\s*https:\/\/[^<]*(googlevideo\.com|youtube\.com|ytimg\.com)/);
  });

  it('emits no image AdaptationSet when thumbnails are not requested', async () => {
    const { xml, seen } = await generate();
    expect(xml).not.toContain('contentType="image"');
    expect(seen.some((u) => u.includes('ytimg.com'))).toBe(false);
  });
});
