import { describe, expect, it, vi } from 'vitest';
import {
  isValidChannelId,
  isValidPlaylistId,
  isValidVideoId,
  parseYouTubeUrl,
} from '../innertube/map/url.js';
import { InnertubeYouTubeSource, type InnertubeYouTubeSourceOptions } from '../innertube/source.js';
import { FakeYouTubeSource } from '../fake/FakeYouTubeSource.js';
import { identityRewriter } from '../contract.js';

const V = 'dQw4w9WgXcQ';
const UC = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';
const PL = 'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI';

// ---------------------------------------------------------------------------
// parseYouTubeUrl — offline resolution
// ---------------------------------------------------------------------------

describe('parseYouTubeUrl — recognised YouTube URLs', () => {
  const videoCases: [string, string][] = [
    [`https://www.youtube.com/watch?v=${V}`, V],
    [`https://m.youtube.com/watch?v=${V}&list=PLabc`, V],
    [`https://music.youtube.com/watch?v=${V}`, V],
    [`https://youtu.be/${V}`, V],
    [`https://youtu.be/${V}?feature=share`, V],
    [`https://www.youtube.com/shorts/${V}`, V],
    [`https://www.youtube.com/live/${V}`, V],
    [`https://www.youtube.com/embed/${V}`, V],
    [`https://www.youtube.com/v/${V}`, V],
    [`https://www.youtube-nocookie.com/embed/${V}`, V],
  ];
  it.each(videoCases)('%s → video %s', (url, id) => {
    expect(parseYouTubeUrl(url)).toEqual({ kind: 'video', videoId: id });
  });

  it('extracts startSec from t / start in several forms', () => {
    expect(parseYouTubeUrl(`https://youtu.be/${V}?t=90`)).toEqual({
      kind: 'video',
      videoId: V,
      startSec: 90,
    });
    expect(parseYouTubeUrl(`https://www.youtube.com/watch?v=${V}&t=90s`)).toMatchObject({
      startSec: 90,
    });
    expect(parseYouTubeUrl(`https://www.youtube.com/watch?v=${V}&t=1m30s`)).toMatchObject({
      startSec: 90,
    });
    expect(parseYouTubeUrl(`https://www.youtube.com/watch?v=${V}&start=1h2m3s`)).toMatchObject({
      startSec: 3723,
    });
  });

  it('resolves playlist / channel / results', () => {
    expect(parseYouTubeUrl(`https://www.youtube.com/playlist?list=${PL}`)).toEqual({
      kind: 'playlist',
      playlistId: PL,
    });
    expect(parseYouTubeUrl(`https://www.youtube.com/channel/${UC}`)).toEqual({
      kind: 'channel',
      channelId: UC,
    });
    expect(parseYouTubeUrl('https://www.youtube.com/results?search_query=lofi+beats')).toEqual({
      kind: 'search',
      query: 'lofi beats',
    });
  });

  it('returns null (→ network fallback) for handle / vanity URLs', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/@veritasium')).toBeNull();
    expect(parseYouTubeUrl('https://www.youtube.com/c/Veritasium')).toBeNull();
    expect(parseYouTubeUrl('https://www.youtube.com/user/1veritasium')).toBeNull();
  });

  it('treats a non-URL phrase as a search', () => {
    expect(parseYouTubeUrl('lofi hip hop radio')).toEqual({
      kind: 'search',
      query: 'lofi hip hop radio',
    });
    expect(parseYouTubeUrl('veritasium')).toEqual({ kind: 'search', query: 'veritasium' });
  });

  it('rejects an invalid id on an otherwise-valid path', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=$$$')).toMatchObject({
      kind: 'unknown',
    });
    expect(parseYouTubeUrl('https://www.youtube.com/channel/notachannelid')).toMatchObject({
      kind: 'unknown',
    });
  });
});

// The negative battery, in the style of proxy/__tests__/allowlist.test.ts.
describe('parseYouTubeUrl — the SSRF-adjacent negative battery', () => {
  const battery = [
    'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
    'https://evil.com/?x=youtube.com',
    'https://evil.com/#youtube.com',
    'evil.com#youtube.com',
    '//evil.com',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://127.0.0.1/watch?v=dQw4w9WgXcQ',
    'https://[::1]/watch?v=dQw4w9WgXcQ',
    'https://2130706433/watch?v=dQw4w9WgXcQ',
    `https://www.youtube.com/watch?v=${'a'.repeat(3000)}`,
    // U+043E CYRILLIC SMALL LETTER O in place of the Latin 'o's.
    'https://www.yоutube.com/watch?v=dQw4w9WgXcQ',
    'https://evil.com@www.youtube.com/watch?v=dQw4w9WgXcQ',
  ];

  it.each(battery)('%s → { kind: "unknown" }', (raw) => {
    const result = parseYouTubeUrl(raw);
    expect(result?.kind).toBe('unknown');
  });
});

describe('id validators mirror source.ts', () => {
  it('videoId', () => {
    expect(isValidVideoId(V)).toBe(true);
    expect(isValidVideoId('short')).toBe(false);
    expect(isValidVideoId('way-too-long-to-be-an-id')).toBe(false);
  });
  it('playlistId', () => {
    expect(isValidPlaylistId(PL)).toBe(true);
    expect(isValidPlaylistId('x')).toBe(false);
  });
  it('channelId', () => {
    expect(isValidChannelId(UC)).toBe(true);
    expect(isValidChannelId('UCtooshort')).toBe(false);
    expect(isValidChannelId('XX_x5XG1OV2P6uZZ5FSM9Ttw')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// InnertubeYouTubeSource.resolveUrl — allow-list runs before the network
// ---------------------------------------------------------------------------

function sourceWith(yt: Record<string, unknown>): InnertubeYouTubeSource {
  return new InnertubeYouTubeSource({
    cacheDir: '',
    rewriters: { media: identityRewriter },
    createInnertube: (() =>
      Promise.resolve(yt)) as unknown as InnertubeYouTubeSourceOptions['createInnertube'],
  });
}

describe('InnertubeYouTubeSource.resolveUrl', () => {
  it('never calls the network for a URL it can resolve or reject locally', async () => {
    const resolveURL = vi.fn();
    const src = sourceWith({ resolveURL });
    for (const raw of [
      `https://youtu.be/${V}`,
      'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
      'file:///etc/passwd',
      '//evil.com',
      'lofi hip hop',
    ]) {
      await src.resolveUrl({ url: raw });
    }
    expect(resolveURL).not.toHaveBeenCalled();
  });

  it('falls back to yt.resolveURL for a handle and maps + re-validates the payload', async () => {
    const resolveURL = vi.fn(() => Promise.resolve({ payload: { browseId: UC } }));
    const src = sourceWith({ resolveURL });
    const res = await src.resolveUrl({ url: 'https://www.youtube.com/@veritasium' });
    expect(resolveURL).toHaveBeenCalledWith('https://www.youtube.com/@veritasium');
    expect(res.ok && res.value).toEqual({ kind: 'channel', channelId: UC });
  });

  it('returns { kind: "unknown" } when the resolved payload carries no valid id', async () => {
    const src = sourceWith({
      resolveURL: vi.fn(() => Promise.resolve({ payload: { browseId: 'FEwhatever' } })),
    });
    const res = await src.resolveUrl({ url: 'https://www.youtube.com/c/somebody' });
    expect(res.ok && res.value.kind).toBe('unknown');
  });

  it('maps a thrown resolveURL to a LuneError', async () => {
    const src = sourceWith({
      resolveURL: vi.fn(() => Promise.reject(new Error('Failed to resolve URL'))),
    });
    const res = await src.resolveUrl({ url: 'https://www.youtube.com/@ghost' });
    expect(res.ok).toBe(false);
  });
});

describe('FakeYouTubeSource.resolveUrl', () => {
  const fake = new FakeYouTubeSource();

  it('resolves a direct URL offline and reports unknown for a handle', async () => {
    expect((await fake.resolveUrl({ url: `https://youtu.be/${V}` })).ok).toBe(true);
    const handle = await fake.resolveUrl({ url: 'https://www.youtube.com/@veritasium' });
    expect(handle.ok && handle.value.kind).toBe('unknown');
  });
});
