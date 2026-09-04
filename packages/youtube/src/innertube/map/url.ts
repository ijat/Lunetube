/**
 * Local, offline parsing of a pasted YouTube URL / share link → `NavTarget`.
 * Pure — no I/O, no `youtubei.js`.
 *
 * `resolveUrl` in `source.ts` calls `parseYouTubeUrl` first and only falls back
 * to the network (`yt.resolveURL`) when this returns `null` — i.e. for a
 * `/@handle`, `/c/<name>` or `/user/<name>` on a YouTube host, whose target id
 * genuinely cannot be known without asking YouTube.
 *
 * **The host allow-list runs before any network call** (plan P2-3, mirroring the
 * proxy's `allowlist.ts` discipline): a non-YouTube URL resolves to
 * `{ kind: 'unknown' }` here and is never forwarded upstream. The allow-list is
 * an anchored regex against `URL.hostname` — never `endsWith`, which
 * `youtube.com.evil.com` would defeat.
 */
import type { NavTarget } from '@lunetube/shared';

/** Max accepted input length. A real share URL is well under 2 KB. */
const MAX_URL_LENGTH = 2048;

/**
 * Anchored host allow-list. `URL` has already lower-cased and punycoded the
 * hostname, so an IDN homograph fails these and a trailing FQDN dot does too.
 */
const YOUTUBE_HOSTS: readonly RegExp[] = [
  /^(www\.|m\.|music\.)?youtube\.com$/,
  /^youtu\.be$/,
  /^(www\.)?youtube-nocookie\.com$/,
];

/** Mirror of `source.ts`'s `normalizeId` (`/^[\w-]{6,20}$/`). */
export function isValidVideoId(value: string): boolean {
  return /^[\w-]{6,20}$/.test(value);
}
export function isValidPlaylistId(value: string): boolean {
  return /^[\w-]{2,64}$/.test(value);
}
export function isValidChannelId(value: string): boolean {
  return /^UC[\w-]{22}$/.test(value);
}

function unknown(url: string): NavTarget {
  return { kind: 'unknown', url };
}

/** Does this string look like an attempt to type a URL (vs a search phrase)? */
function looksLikeUrl(s: string): boolean {
  if (/\s/.test(s)) return false;
  if (s.startsWith('//')) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return true; // has a scheme
  return /^([a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#]|$)/i.test(s); // bare host[/…]
}

function tryUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** `"90"` / `"90s"` / `"1m30s"` / `"1h2m3s"` → seconds. `null` if unparseable. */
function parseStartParam(url: URL): number | undefined {
  const raw = url.searchParams.get('t') ?? url.searchParams.get('start');
  if (raw == null || raw.length === 0) return undefined;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(raw);
  if (m == null || (m[1] == null && m[2] == null && m[3] == null)) return undefined;
  const secs = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return secs > 0 ? secs : undefined;
}

function video(id: string, startSec: number | undefined): NavTarget | null {
  if (!isValidVideoId(id)) return null;
  return startSec !== undefined
    ? { kind: 'video', videoId: id, startSec }
    : { kind: 'video', videoId: id };
}

/**
 * Parse `raw` locally.
 *
 *  - not a URL attempt (a search phrase)        → `{ kind: 'search' }`
 *  - a URL we can fully resolve offline          → `video` / `playlist` / `channel` / `search`
 *  - a YouTube `/@handle` `/c/` `/user/` URL     → `null` (caller does the network hop)
 *  - anything else (bad scheme, foreign host, …) → `{ kind: 'unknown' }`, **no network**
 */
export function parseYouTubeUrl(raw: string): NavTarget | null {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed.length === 0) return unknown(trimmed);
  if (trimmed.length > MAX_URL_LENGTH) return unknown(trimmed);

  let url = tryUrl(trimmed);
  if (url == null) {
    if (!looksLikeUrl(trimmed)) return { kind: 'search', query: trimmed };
    url = tryUrl(trimmed.startsWith('//') ? `https:${trimmed}` : `https://${trimmed}`);
    if (url == null) return unknown(trimmed);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return unknown(trimmed);
  if (url.username !== '' || url.password !== '') return unknown(trimmed);
  if (!YOUTUBE_HOSTS.some((re) => re.test(url.hostname))) return unknown(trimmed);

  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
  const startSec = parseStartParam(url);

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0] ?? '';
    return video(decodeURIComponent(id), startSec) ?? unknown(trimmed);
  }

  const path = url.pathname;

  if (path === '/watch') {
    const v = url.searchParams.get('v') ?? '';
    return video(v, startSec) ?? unknown(trimmed);
  }

  const seg = /^\/(shorts|live|embed|v)\/([^/?#]+)/.exec(path);
  if (seg != null) {
    return video(decodeURIComponent(seg[2] ?? ''), startSec) ?? unknown(trimmed);
  }

  if (path === '/playlist') {
    const list = url.searchParams.get('list') ?? '';
    return isValidPlaylistId(list) ? { kind: 'playlist', playlistId: list } : unknown(trimmed);
  }

  const chan = /^\/channel\/([^/?#]+)/.exec(path);
  if (chan != null) {
    const id = decodeURIComponent(chan[1] ?? '');
    return isValidChannelId(id) ? { kind: 'channel', channelId: id } : unknown(trimmed);
  }

  if (path === '/results') {
    const q = (url.searchParams.get('search_query') ?? '').trim();
    return q.length > 0 ? { kind: 'search', query: q } : unknown(trimmed);
  }

  // Vanity / handle paths — the id is only knowable via the network.
  if (/^\/(@[^/?#]+|c\/[^/?#]+|user\/[^/?#]+)/.test(path)) return null;

  return unknown(trimmed);
}
