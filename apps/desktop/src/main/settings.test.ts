import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@lunetube/shared';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/lunetube-test' } }));

const { coerce } = await import('./settings.js');

describe('coerce (settings validation, F2)', () => {
  it('returns all defaults for a non-object', () => {
    expect(coerce(null)).toEqual(DEFAULT_SETTINGS);
    expect(coerce('nope')).toEqual(DEFAULT_SETTINGS);
    expect(coerce(42)).toEqual(DEFAULT_SETTINGS);
  });

  it('drops unknown keys', () => {
    const out = coerce({ theme: 'purple', hackerKey: 'rm -rf' });
    expect(Object.keys(out)).not.toContain('hackerKey');
    expect(out.theme).toBe('purple');
  });

  it('falls back to default for an out-of-set theme', () => {
    expect(coerce({ theme: 'chartreuse' }).theme).toBe(DEFAULT_SETTINGS.theme);
  });

  it('is NaN-safe on numeric fields', () => {
    expect(coerce({ glassLevel: 'abc' }).glassLevel).toBe(DEFAULT_SETTINGS.glassLevel);
    expect(coerce({ glassLevel: NaN }).glassLevel).toBe(DEFAULT_SETTINGS.glassLevel);
    expect(coerce({ thumbnailCacheMb: undefined }).thumbnailCacheMb).toBe(
      DEFAULT_SETTINGS.thumbnailCacheMb,
    );
  });

  it('clamps in-range numbers rather than rejecting them', () => {
    expect(coerce({ glassLevel: 0 }).glassLevel).toBe(0.4);
    expect(coerce({ glassLevel: 5 }).glassLevel).toBe(1);
    expect(coerce({ defaultSpeed: 99 }).defaultSpeed).toBe(4);
    expect(coerce({ thumbnailCacheMb: 10 }).thumbnailCacheMb).toBe(64);
  });

  it('requires sponsorBlockBaseUrl to parse as https', () => {
    expect(coerce({ sponsorBlockBaseUrl: 'http://evil.test' }).sponsorBlockBaseUrl).toBe(
      DEFAULT_SETTINGS.sponsorBlockBaseUrl,
    );
    expect(coerce({ sponsorBlockBaseUrl: 'not a url' }).sponsorBlockBaseUrl).toBe(
      DEFAULT_SETTINGS.sponsorBlockBaseUrl,
    );
    expect(coerce({ sponsorBlockBaseUrl: 'https://sb.example.test' }).sponsorBlockBaseUrl).toBe(
      'https://sb.example.test',
    );
  });

  it('rejects non-boolean flags', () => {
    expect(coerce({ autoplay: 'yes' }).autoplay).toBe(DEFAULT_SETTINGS.autoplay);
    expect(coerce({ historyEnabled: 0 }).historyEnabled).toBe(DEFAULT_SETTINGS.historyEnabled);
    expect(coerce({ autoplay: false }).autoplay).toBe(false);
  });

  it('accepts a fully valid settings object unchanged', () => {
    const valid = {
      ...DEFAULT_SETTINGS,
      theme: 'green' as const,
      glassLevel: 0.55,
      autoplay: false,
    };
    expect(coerce(valid)).toEqual(valid);
  });
});
