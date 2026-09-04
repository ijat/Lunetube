import { describe, expect, it } from 'vitest';
import { getNextPageParam, isStaleContinuation, ytKeys } from './queries.js';
import { IpcError } from './ipc.js';

/**
 * Pins the shapes P2-6's spec calls out explicitly: query keys (so cache
 * entries for different filters/sorts/tabs never collide) and the shared
 * `getNextPageParam` helper (so a page without a `continuation` correctly
 * ends pagination rather than looping).
 */

describe('ytKeys (P2-6)', () => {
  it('search key includes query and filters', () => {
    expect(
      ytKeys.search('cats', { sort: 'views', uploadDate: 'week', duration: 'any', type: 'all' }),
    ).toEqual([
      'yt',
      'search',
      'cats',
      { sort: 'views', uploadDate: 'week', duration: 'any', type: 'all' },
    ]);
  });

  it('search key omits filters when not given', () => {
    expect(ytKeys.search('cats')).toEqual(['yt', 'search', 'cats', undefined]);
  });

  it('suggestions key', () => {
    expect(ytKeys.suggestions('ca')).toEqual(['yt', 'suggestions', 'ca']);
  });

  it('comments key includes sort so top/newest never share a cache entry', () => {
    expect(ytKeys.comments('abc123', 'top')).toEqual(['yt', 'comments', 'abc123', 'top']);
    expect(ytKeys.comments('abc123', 'newest')).toEqual(['yt', 'comments', 'abc123', 'newest']);
  });

  it('commentReplies key', () => {
    expect(ytKeys.commentReplies('replies-first:abc')).toEqual([
      'yt',
      'commentReplies',
      'replies-first:abc',
    ]);
  });

  it('channel key includes tab so videos/shorts/playlists/about/live/podcasts never collide', () => {
    expect(ytKeys.channel('UC123', 'videos')).toEqual(['yt', 'channel', 'UC123', 'videos']);
    expect(ytKeys.channel('UC123', 'about')).toEqual(['yt', 'channel', 'UC123', 'about']);
  });

  it('playlist key', () => {
    expect(ytKeys.playlist('PL123')).toEqual(['yt', 'playlist', 'PL123']);
  });
});

describe('getNextPageParam (P2-6)', () => {
  it('returns the continuation when present', () => {
    expect(getNextPageParam({ continuation: 'tok-2' })).toBe('tok-2');
  });

  it('returns undefined when continuation is absent (end of list)', () => {
    expect(getNextPageParam({})).toBeUndefined();
  });
});

describe('isStaleContinuation (P2-6)', () => {
  it('is true for INVALID_INPUT with a continuation: detail', () => {
    const error = new IpcError({
      code: 'INVALID_INPUT',
      message: 'This search refreshed. Reload to keep browsing.',
      retryable: false,
      detail: 'continuation:search',
    });
    expect(isStaleContinuation(error)).toBe(true);
  });

  it('is false for INVALID_INPUT without a continuation: detail (an ordinary validation error)', () => {
    const error = new IpcError({
      code: 'INVALID_INPUT',
      message: 'query must be 1-256 characters',
      retryable: false,
    });
    expect(isStaleContinuation(error)).toBe(false);
  });

  it('is false for a different error code', () => {
    const error = new IpcError({
      code: 'YT_RATE_LIMITED',
      message: 'slow down',
      retryable: true,
      detail: 'continuation:comments',
    });
    expect(isStaleContinuation(error)).toBe(false);
  });

  it('is false for a non-IpcError value', () => {
    expect(isStaleContinuation(new Error('plain'))).toBe(false);
    expect(isStaleContinuation('nope')).toBe(false);
    expect(isStaleContinuation(undefined)).toBe(false);
  });
});
