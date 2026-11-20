import { describe, expect, it } from 'vitest';
import { LIBRARY_LIMITS, WATCH_LATER_ID } from '../models/library.js';
import { CHANNELS } from '../ipc.js';

describe('LIBRARY_LIMITS', () => {
  it('is all positive integers', () => {
    for (const [key, value] of Object.entries(LIBRARY_LIMITS)) {
      expect(Number.isInteger(value), `${key} should be an integer`).toBe(true);
      expect(value, `${key} should be positive`).toBeGreaterThan(0);
    }
  });

  it('caps a single add at the total queue size (queueAddMax <= queueMax)', () => {
    expect(LIBRARY_LIMITS.queueAddMax).toBeLessThanOrEqual(LIBRARY_LIMITS.queueMax);
  });

  it('derives videosMax from the per-list caps — the import cap for videos[]', () => {
    const expected =
      LIBRARY_LIMITS.historyMax +
      (LIBRARY_LIMITS.playlistsMax + 1) * LIBRARY_LIMITS.playlistItemsMax +
      LIBRARY_LIMITS.queueMax;
    expect(LIBRARY_LIMITS.videosMax).toBe(expected);
    expect(LIBRARY_LIMITS.videosMax).toBe(151_500);
  });
});

describe('WATCH_LATER_ID', () => {
  it('is the stable sentinel id, shaped nothing like a generated playlist uuid', () => {
    expect(WATCH_LATER_ID).toBe('watch-later');
    expect(WATCH_LATER_ID).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});

describe('CHANNELS', () => {
  it('has no duplicate channel string — a duplicate would silently alias two handlers', () => {
    const values = Object.values(CHANNELS);
    expect(new Set(values).size).toBe(values.length);
  });
});
