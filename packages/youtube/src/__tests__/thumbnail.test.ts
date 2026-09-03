import { describe, expect, it } from 'vitest';
import {
  pickThumbnail,
  pickThumbnailUrl,
  pickThumbnailUrlRewritten,
} from '../innertube/map/thumbnail.js';

const set = [
  { url: '//i.ytimg.com/vi/x/default.jpg', width: 120, height: 90 },
  { url: 'https://i.ytimg.com/vi/x/hqdefault.jpg', width: 480, height: 360 },
  { url: 'https://i.ytimg.com/vi/x/maxres.jpg', width: 1280, height: 720 },
];

describe('pickThumbnail', () => {
  it('returns null for empty / missing / url-less input', () => {
    expect(pickThumbnail(undefined)).toBeNull();
    expect(pickThumbnail([])).toBeNull();
    expect(pickThumbnail([{ width: 10, height: 10 }])).toBeNull();
  });

  it('picks the largest by area', () => {
    expect(pickThumbnailUrl(set)).toBe('https://i.ytimg.com/vi/x/maxres.jpg');
  });

  it('respects a maxWidth cap, falling back to smallest-over when all exceed', () => {
    expect(pickThumbnailUrl(set, { maxWidth: 500 })).toBe('https://i.ytimg.com/vi/x/hqdefault.jpg');
    expect(pickThumbnailUrl(set, { maxWidth: 50 })).toBe('https://i.ytimg.com/vi/x/maxres.jpg');
  });

  it('normalises protocol-relative URLs', () => {
    expect(pickThumbnailUrl([{ url: '//host/a.jpg', width: 1, height: 1 }])).toBe(
      'https://host/a.jpg',
    );
  });

  it('routes through a rewriter when asked', () => {
    const rewritten = pickThumbnailUrlRewritten(
      set,
      (u) => new URL(`http://127.0.0.1:9/img?u=${encodeURIComponent(u.toString())}`),
    );
    expect(rewritten).toContain('http://127.0.0.1:9/img?u=');
    expect(rewritten).toContain('maxres.jpg');
  });
});
