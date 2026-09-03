/**
 * youtubei.js error / `playability_status` → `LuneError` (PRD §8: one "YouTube
 * changed something" surface with retry + a diagnostics panel).
 *
 * This is one of only three files allowed to import `youtubei.js`
 * (`session.ts`, `source.ts`, this one) — it needs the concrete error classes
 * for `instanceof`, with message-based fallbacks for resilience.
 */
import { Utils } from 'youtubei.js';
import { isLuneError, makeLuneError, type LuneError } from '@lunetube/shared';

/** Loosely-typed `IPlayabilityStatus`. */
export interface PlayabilityLike {
  status?: unknown;
  reason?: unknown;
}

const BOT_CHECK = /sign in to confirm (that )?you.?re not a bot/i;
const NETWORK =
  /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|getaddrinfo|network|socket hang up/i;
const RATE_LIMIT = /\b429\b|too many requests|rate.?limit/i;
const UNAVAILABLE =
  /not (found|available)|unavailable|is private|was removed|has been removed|does not exist|deleted/i;

const PARSE_HINT =
  'YouTube changed a response shape. This usually clears up after a youtubei.js update.';
const BOT_HINT =
  "This InnerTube client is blocked from this IP address (YouTube's anti-bot check). Try again later or from a different network.";

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

/**
 * Maps a non-OK `playability_status` to a `LuneError`, or `null` when playable.
 */
export function mapPlayabilityStatus(status: PlayabilityLike | null | undefined): LuneError | null {
  if (status == null) return null;
  const code = typeof status.status === 'string' ? status.status.toUpperCase() : '';
  const reason = typeof status.reason === 'string' ? status.reason : '';
  if (code === '' || code === 'OK') return null;

  if (BOT_CHECK.test(reason)) {
    return makeLuneError('YT_LOGIN_REQUIRED', reason, {
      hint: BOT_HINT,
      detail: `playability:${code}`,
    });
  }

  switch (code) {
    case 'LOGIN_REQUIRED':
    case 'AGE_VERIFICATION_REQUIRED':
    case 'AGE_CHECK_REQUIRED':
    case 'CONTENT_CHECK_REQUIRED':
      return makeLuneError('YT_LOGIN_REQUIRED', reason || 'This video requires sign-in.', {
        detail: `playability:${code}`,
      });
    case 'LIVE_STREAM_OFFLINE':
      return makeLuneError('YT_UNAVAILABLE', reason || 'This live stream is offline.', {
        detail: `playability:${code}`,
      });
    default:
      return makeLuneError('YT_UNAVAILABLE', reason || 'This video is unavailable.', {
        detail: `playability:${code}`,
      });
  }
}

/**
 * Maps any thrown value from a youtubei.js call to a `LuneError`. Already-mapped
 * `LuneError`s pass through unchanged.
 */
export function mapYoutubeError(err: unknown): LuneError {
  if (isLuneError(err)) return err;

  const message = messageOf(err);

  if (NETWORK.test(message)) {
    return makeLuneError('YT_NETWORK', message, { detail: 'fetch' });
  }
  if (RATE_LIMIT.test(message)) {
    return makeLuneError('YT_RATE_LIMITED', message, { detail: 'http:429' });
  }
  if (BOT_CHECK.test(message)) {
    return makeLuneError('YT_LOGIN_REQUIRED', message, { hint: BOT_HINT });
  }

  // ParsingError extends InnertubeError — check it first.
  if (err instanceof Utils.ParsingError) {
    return makeLuneError('YT_PARSE_CHANGED', message, { detail: 'ParsingError', hint: PARSE_HINT });
  }
  if (err instanceof Utils.PlayerError) {
    return makeLuneError('YT_PARSE_CHANGED', message, { detail: 'PlayerError', hint: PARSE_HINT });
  }
  if (err instanceof Utils.InnertubeError) {
    if (UNAVAILABLE.test(message)) {
      return makeLuneError('YT_UNAVAILABLE', message, { detail: 'InnertubeError' });
    }
    return makeLuneError('INTERNAL', message, { detail: 'InnertubeError' });
  }
  if (/parse|parsing|unexpected token|cannot read propert/i.test(message)) {
    return makeLuneError('YT_PARSE_CHANGED', message, { detail: 'parse', hint: PARSE_HINT });
  }

  return makeLuneError('INTERNAL', message);
}

/** Sugar for the seven Phase-2 methods. */
export function notImplemented(method: string): LuneError {
  return makeLuneError('NOT_IMPLEMENTED', `${method} is not implemented until Phase 2.`, {
    detail: `phase2:${method}`,
  });
}
