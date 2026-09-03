import { describe, expect, it } from 'vitest';
import { mapPlayabilityStatus, mapYoutubeError, notImplemented } from '../innertube/errors.js';

describe('mapPlayabilityStatus', () => {
  it('returns null for OK / empty / missing', () => {
    expect(mapPlayabilityStatus(undefined)).toBeNull();
    expect(mapPlayabilityStatus({ status: 'OK', reason: '' })).toBeNull();
    expect(mapPlayabilityStatus({})).toBeNull();
  });

  it('maps the anti-bot reason to YT_LOGIN_REQUIRED with a hint, regardless of status', () => {
    const e = mapPlayabilityStatus({
      status: 'LOGIN_REQUIRED',
      reason: "Sign in to confirm you're not a bot",
    });
    expect(e?.code).toBe('YT_LOGIN_REQUIRED');
    expect(e?.retryable).toBe(false);
    expect(e?.hint).toMatch(/IP address/i);
  });

  it('maps age / content checks to YT_LOGIN_REQUIRED', () => {
    expect(mapPlayabilityStatus({ status: 'AGE_CHECK_REQUIRED', reason: '' })?.code).toBe(
      'YT_LOGIN_REQUIRED',
    );
    expect(mapPlayabilityStatus({ status: 'CONTENT_CHECK_REQUIRED', reason: '' })?.code).toBe(
      'YT_LOGIN_REQUIRED',
    );
  });

  it('maps UNPLAYABLE / ERROR / offline to YT_UNAVAILABLE and keeps the reason', () => {
    expect(
      mapPlayabilityStatus({ status: 'UNPLAYABLE', reason: 'This video is private.' }),
    ).toMatchObject({
      code: 'YT_UNAVAILABLE',
      message: 'This video is private.',
    });
    expect(mapPlayabilityStatus({ status: 'LIVE_STREAM_OFFLINE', reason: '' })?.code).toBe(
      'YT_UNAVAILABLE',
    );
    expect(mapPlayabilityStatus({ status: 'ERROR', reason: '' })?.code).toBe('YT_UNAVAILABLE');
  });
});

describe('mapYoutubeError', () => {
  it('passes an already-mapped LuneError through unchanged', () => {
    const lune = { code: 'YT_RATE_LIMITED' as const, message: 'slow', retryable: true };
    expect(mapYoutubeError(lune)).toBe(lune);
  });

  it('classifies network failures as retryable YT_NETWORK', () => {
    const e = mapYoutubeError(new TypeError('fetch failed'));
    expect(e.code).toBe('YT_NETWORK');
    expect(e.retryable).toBe(true);
  });

  it('classifies 429 as YT_RATE_LIMITED', () => {
    expect(mapYoutubeError(new Error('Request failed with status 429')).code).toBe(
      'YT_RATE_LIMITED',
    );
  });

  it('classifies the anti-bot message as YT_LOGIN_REQUIRED', () => {
    expect(mapYoutubeError(new Error("Sign in to confirm you're not a bot")).code).toBe(
      'YT_LOGIN_REQUIRED',
    );
  });

  it('classifies parser-shaped messages as YT_PARSE_CHANGED', () => {
    expect(
      mapYoutubeError(new Error('Cannot read properties of undefined (reading "runs")')).code,
    ).toBe('YT_PARSE_CHANGED');
  });

  it('falls back to INTERNAL for anything unrecognised', () => {
    const e = mapYoutubeError('weird');
    expect(e.code).toBe('INTERNAL');
    expect(e.message).toBe('weird');
  });
});

describe('notImplemented', () => {
  it('produces a non-retryable NOT_IMPLEMENTED error naming the method', () => {
    const e = notImplemented('search');
    expect(e.code).toBe('NOT_IMPLEMENTED');
    expect(e.retryable).toBe(false);
    expect(e.message).toContain('search');
  });
});
