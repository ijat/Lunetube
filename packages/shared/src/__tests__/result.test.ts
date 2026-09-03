import { describe, expect, it } from 'vitest';
import { andThen, err, isErr, isOk, map, mapErr, ok, unwrapOr } from '../result.js';
import { makeLuneError, isLuneError } from '../errors.js';

describe('Result constructors and guards', () => {
  it('ok() produces a success variant', () => {
    const r = ok(42);
    expect(r).toEqual({ ok: true, value: 42 });
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
  });

  it('err() produces a failure variant', () => {
    const r = err('boom');
    expect(r).toEqual({ ok: false, error: 'boom' });
    expect(isOk(r)).toBe(false);
    expect(isErr(r)).toBe(true);
  });
});

describe('Result combinators', () => {
  it('map transforms the value only on success', () => {
    expect(map(ok(2), (n) => n * 3)).toEqual({ ok: true, value: 6 });
    expect(map(err<string>('e'), (n: number) => n * 3)).toEqual({ ok: false, error: 'e' });
  });

  it('mapErr transforms the error only on failure', () => {
    expect(mapErr(err('e'), (s) => s.toUpperCase())).toEqual({ ok: false, error: 'E' });
    expect(mapErr(ok<number>(1), (s: string) => s.toUpperCase())).toEqual({ ok: true, value: 1 });
  });

  it('andThen chains fallible operations and short-circuits on failure', () => {
    const parse = (s: string) => (Number.isNaN(Number(s)) ? err('nan') : ok(Number(s)));
    expect(andThen(ok('10'), parse)).toEqual({ ok: true, value: 10 });
    expect(andThen(ok('x'), parse)).toEqual({ ok: false, error: 'nan' });
    expect(andThen(err<string>('prior'), parse)).toEqual({ ok: false, error: 'prior' });
  });

  it('unwrapOr returns the value or the fallback', () => {
    expect(unwrapOr(ok(5), 0)).toBe(5);
    expect(unwrapOr<number, string>(err('e'), 0)).toBe(0);
  });
});

describe('makeLuneError', () => {
  it('applies the default retryable flag per code', () => {
    expect(makeLuneError('YT_NETWORK', 'offline').retryable).toBe(true);
    expect(makeLuneError('YT_RATE_LIMITED', 'slow down').retryable).toBe(true);
    expect(makeLuneError('YT_LOGIN_REQUIRED', 'bot check').retryable).toBe(false);
    expect(makeLuneError('INVALID_INPUT', 'bad id').retryable).toBe(false);
  });

  it('allows the retryable flag to be overridden and omits absent optionals', () => {
    const e = makeLuneError('INTERNAL', 'weird', { retryable: true });
    expect(e.retryable).toBe(true);
    expect('detail' in e).toBe(false);
    expect('hint' in e).toBe(false);
  });

  it('keeps detail and hint when provided', () => {
    const e = makeLuneError('YT_PARSE_CHANGED', 'shape changed', {
      detail: 'map/video.ts:42',
      hint: 'update youtubei.js',
    });
    expect(e.detail).toBe('map/video.ts:42');
    expect(e.hint).toBe('update youtubei.js');
    expect(isLuneError(e)).toBe(true);
  });

  it('isLuneError rejects non-errors', () => {
    expect(isLuneError(null)).toBe(false);
    expect(isLuneError({ code: 'X' })).toBe(false);
    expect(isLuneError('nope')).toBe(false);
  });
});
