/**
 * The proxy's SSRF boundary (plan Architecture → "The media proxy"). Everything
 * in this file is a pure function of its arguments — no I/O, no process state —
 * so every rejection path is directly unit-testable.
 *
 * Invariants this module exists to preserve:
 *
 * 1. **A target host is only ever matched by an anchored regex against
 *    `new URL(target).hostname`.** Never `endsWith`, never `includes`, never a
 *    substring test on the raw string. `https://googlevideo.com.evil.com/` and
 *    `https://evil.com/?x=.googlevideo.com` both have a hostname that fails an
 *    anchored match; either would defeat a suffix test.
 * 2. **The scheme is allow-listed per route** (`https:` in production), so
 *    `file:`, `data:`, `blob:` and plain `http:` targets can never be reached.
 * 3. **Userinfo is rejected outright.** `https://user:pass@host/` is a classic
 *    parser-confusion vector and we have no use for it.
 * 4. **The encoded target is canonical base64url.** A non-canonical encoding
 *    that decodes to the same bytes is rejected, so there is exactly one
 *    on-the-wire spelling of any given target.
 *
 * None of the regexes carry the `g` flag: a global regex keeps `lastIndex`
 * state across `.test()` calls and would intermittently return `false` for a
 * host it had just matched. Do not add one.
 */

export type RouteName = 'media' | 'img' | 'caption';

export interface RouteRule {
  readonly name: RouteName;
  /** Allowed `URL.protocol` values, including the trailing colon. */
  readonly protocols: readonly string[];
  /** Anchored match against `URL.hostname` (already lower-cased and punycoded by `URL`). */
  readonly host: RegExp;
  /** Optional anchored match against `URL.pathname`. */
  readonly pathname?: RegExp;
}

/**
 * Upper bound on the `u=` query parameter. A googlevideo URL is ~1–2 KB; 8 KB
 * of base64url (≈6 KB decoded) is generous while still bounding the work an
 * attacker can make the proxy do before the allow-list rejects them.
 */
export const MAX_TARGET_PARAM_LENGTH = 8192;

/**
 * Media CDN hosts, e.g. `rr3---sn-4g5edn7z.googlevideo.com`. One label, then
 * the apex. The plan writes this as `^[\w-]+\.googlevideo\.com$`; `[a-z0-9-]`
 * is used instead because `\w` also admits `_`, which is not a legal character
 * in these hostnames — strictly narrower, same shape.
 *
 * A trailing FQDN dot (`…googlevideo.com.`) does not match, which is
 * deliberate: `URL` preserves it and some resolvers treat it as equivalent.
 */
export const MEDIA_HOST = /^[a-z0-9-]+\.googlevideo\.com$/;

/**
 * Thumbnail / avatar / storyboard hosts.
 *
 * - `i.ytimg.com`, `i1..i9.ytimg.com` — video thumbnails and `/sb/` storyboards.
 * - `yt3.ggpht.com`, `yt4.ggpht.com` — channel and comment-author avatars.
 * - `yt3.googleusercontent.com` — the newer avatar host YouTube now serves.
 * - `lh3.googleusercontent.com` — legacy avatar host.
 *
 * The plan lists `i\d?\.ytimg\.com`, `yt\d\.ggpht\.com` and
 * `lh\d\.googleusercontent\.com`. `yt\d?\.googleusercontent\.com` is added
 * because YouTube migrated avatars onto it; without it every channel avatar
 * would 400 at the proxy. Still anchored, still an exact host set.
 */
export const IMAGE_HOST =
  /^(?:i\d?\.ytimg\.com|yt\d?\.ggpht\.com|(?:yt|lh)\d?\.googleusercontent\.com)$/;

/** Caption host — exactly `www.youtube.com`, and only the timedtext endpoint. */
export const CAPTION_HOST = /^www\.youtube\.com$/;
export const CAPTION_PATHNAME = /^\/api\/timedtext$/;

/**
 * The route table used by the real proxy. `server.ts` accepts a table as
 * configuration so the integration tests can point a route at a local fixture
 * origin; `index.ts` — the only thing the rest of main may call — always binds
 * this one and offers no way to override it.
 */
export const PRODUCTION_ROUTES: Readonly<Record<RouteName, RouteRule>> = {
  media: { name: 'media', protocols: ['https:'], host: MEDIA_HOST },
  img: { name: 'img', protocols: ['https:'], host: IMAGE_HOST },
  caption: {
    name: 'caption',
    protocols: ['https:'],
    host: CAPTION_HOST,
    pathname: CAPTION_PATHNAME,
  },
};

export const ROUTE_NAMES: readonly RouteName[] = ['media', 'img', 'caption'];

export function isRouteName(value: string): value is RouteName {
  return (ROUTE_NAMES as readonly string[]).includes(value);
}

/** Canonical, unpadded base64url — the only alphabet `encodeTargetParam` emits. */
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Encodes an absolute URL for the `u=` query parameter. Inverse of `decodeTargetParam`. */
export function encodeTargetParam(target: string): string {
  return Buffer.from(target, 'utf8').toString('base64url');
}

/**
 * Decodes `u=`. Returns `null` — never throws — for anything that is not a
 * canonical, length-bounded base64url encoding of valid UTF-8.
 *
 * The round-trip check matters: `Buffer.from(…, 'base64url')` is lenient (it
 * ignores padding, stray characters and non-zero trailing bits), so without it
 * a single target would have many valid spellings. Re-encoding and requiring
 * byte equality collapses that to one.
 */
export function decodeTargetParam(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > MAX_TARGET_PARAM_LENGTH) return null;
  if (!BASE64URL.test(raw)) return null;

  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  if (decoded.length === 0) return null;
  // Also rejects invalid UTF-8, which round-trips through U+FFFD and so fails here.
  if (encodeTargetParam(decoded) !== raw) return null;
  return decoded;
}

/** Anchored scheme + userinfo + host (+ optional path) check for one route. */
export function isAllowedUrl(url: URL, rule: RouteRule): boolean {
  if (!rule.protocols.includes(url.protocol)) return false;
  if (url.username !== '' || url.password !== '') return false;
  if (!rule.host.test(url.hostname)) return false;
  if (rule.pathname && !rule.pathname.test(url.pathname)) return false;
  return true;
}

/**
 * The single entry point the request handler uses: decode `u=`, parse it as an
 * absolute URL, and check it against the route's rule. `null` means "reject";
 * the caller must not distinguish between the failure modes in its response.
 */
export function resolveTarget(raw: string | null | undefined, rule: RouteRule): URL | null {
  const decoded = decodeTargetParam(raw);
  if (decoded === null) return null;

  let url: URL;
  try {
    // No base argument, so a scheme-relative (`//evil.com`) or relative target
    // throws rather than resolving against anything.
    url = new URL(decoded);
  } catch {
    return null;
  }

  return isAllowedUrl(url, rule) ? url : null;
}

/**
 * Re-checks a redirect `Location` against the same rule that admitted the
 * original target. `location` is resolved relative to the URL that produced it,
 * per RFC 7231 §7.1.2, and then must satisfy the rule in full — a redirect can
 * never widen the allow-list.
 */
export function resolveRedirect(location: string, from: URL, rule: RouteRule): URL | null {
  let next: URL;
  try {
    next = new URL(location, from);
  } catch {
    return null;
  }
  return isAllowedUrl(next, rule) ? next : null;
}
