import { describe, expect, it } from 'vitest';
import {
  mapAudioTracks,
  mapCaptionTracks,
  mapStoryboards,
  mapVideoTracks,
  parseMimeType,
  partitionAdaptiveFormats,
} from '../innertube/map/streams.js';
import { loadVideoFixture } from '../fake/fixtures.js';

const proxy = (u: URL): URL =>
  new URL(`http://127.0.0.1:5599/tok/media?u=${encodeURIComponent(u.toString())}`);

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
