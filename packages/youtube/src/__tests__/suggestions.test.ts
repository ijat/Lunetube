import { describe, expect, it, vi } from 'vitest';
import { InnertubeYouTubeSource, type InnertubeYouTubeSourceOptions } from '../innertube/source.js';
import { FakeYouTubeSource } from '../fake/FakeYouTubeSource.js';
import { identityRewriter } from '../contract.js';

function sourceWith(yt: Record<string, unknown>): InnertubeYouTubeSource {
  return new InnertubeYouTubeSource({
    cacheDir: '',
    rewriters: { media: identityRewriter },
    createInnertube: (() =>
      Promise.resolve(yt)) as unknown as InnertubeYouTubeSourceOptions['createInnertube'],
  });
}

describe('InnertubeYouTubeSource.getSearchSuggestions', () => {
  it('trims, de-dupes, drops empties / over-long, and caps at 12', async () => {
    const long = 'x'.repeat(120);
    const raw = [
      '  lofi hip hop  ',
      'lofi hip hop', // dup after trim
      '',
      '   ',
      long,
      ...Array.from({ length: 20 }, (_, i) => `suggestion ${i}`),
    ];
    const getSearchSuggestions = vi.fn(() => Promise.resolve(raw));
    const res = await sourceWith({ getSearchSuggestions }).getSearchSuggestions({ query: 'lofi' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toHaveLength(12);
    expect(res.value[0]).toBe('lofi hip hop');
    expect(res.value.every((s) => s.length > 0 && s.length <= 100)).toBe(true);
    expect(new Set(res.value).size).toBe(res.value.length);
  });

  it('returns ok([]) with no network call for an empty or 1-char query', async () => {
    const getSearchSuggestions = vi.fn();
    const src = sourceWith({ getSearchSuggestions });
    for (const query of ['', ' ', 'a']) {
      const res = await src.getSearchSuggestions({ query });
      expect(res.ok && res.value).toEqual([]);
    }
    expect(getSearchSuggestions).not.toHaveBeenCalled();
  });

  it('maps a parse failure to a LuneError (P2-F7)', async () => {
    const getSearchSuggestions = vi.fn(() =>
      Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0')),
    );
    const res = await sourceWith({ getSearchSuggestions }).getSearchSuggestions({ query: 'lofi' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('YT_PARSE_CHANGED');
  });

  it('tolerates a non-array response', async () => {
    const res = await sourceWith({
      getSearchSuggestions: vi.fn(() => Promise.resolve({ nope: true })),
    }).getSearchSuggestions({ query: 'lofi' });
    expect(res.ok && res.value).toEqual([]);
  });
});

describe('FakeYouTubeSource.getSearchSuggestions', () => {
  const fake = new FakeYouTubeSource();

  it('returns the fixture list (capped at 12) for a matching query', async () => {
    const res = await fake.getSearchSuggestions({ query: 'lofi' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.length).toBeGreaterThan(0);
      expect(res.value.length).toBeLessThanOrEqual(12);
      expect(res.value).toContain('lofi hip hop');
    }
  });

  it('returns [] for a 1-char query without consulting a fixture', async () => {
    expect((await fake.getSearchSuggestions({ query: 'l' })).ok).toBe(true);
    const res = await fake.getSearchSuggestions({ query: 'l' });
    expect(res.ok && res.value).toEqual([]);
  });
});
