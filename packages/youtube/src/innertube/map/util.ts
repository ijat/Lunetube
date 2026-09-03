/**
 * Pure, dependency-free helpers shared by the mappers. No I/O, no throwing —
 * every function returns a best-effort value on malformed input. The mappers are
 * the highest-churn code in the project (plan R3); keeping them defensive is what
 * makes a YouTube response-shape change a one-line fix instead of a crash.
 */

/** A youtubei.js `Text` node, a plain string, or anything else. */
export type MaybeText = string | { text?: unknown; toString?: () => string } | null | undefined;

/** Coerce a youtubei.js `Text`-like value (or a raw string) to a plain string. */
export function textToString(value: MaybeText): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const obj = value as { text?: unknown; runs?: unknown };
    if (typeof obj.text === 'string') return obj.text;
    if (Array.isArray(obj.runs)) {
      return obj.runs
        .map((run) =>
          run && typeof run === 'object' ? String((run as { text?: unknown }).text ?? '') : '',
        )
        .join('');
    }
    if (typeof value.toString === 'function') {
      const s = value.toString();
      if (s && s !== '[object Object]') return s;
    }
  }
  return '';
}

/** Non-empty string or `null`. */
export function nonEmpty(value: MaybeText): string | null {
  const s = textToString(value).trim();
  return s.length > 0 ? s : null;
}

/** Finite number or `null`. Accepts numeric strings ("1,234" → 1234). */
export function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value.replace(/[,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Parse a human-readable count ("8.4M views", "1,234", "1.1K") to a number.
 * Feed nodes only expose these as text. Returns `null` when unparseable.
 */
export function parseHumanCount(value: MaybeText): number | null {
  const s = textToString(value).trim();
  const match = /^([\d,.]+)\s*([KMBkmb])?/.exec(s);
  if (match == null) return null;
  const base = Number((match[1] ?? '').replace(/,/g, ''));
  if (!Number.isFinite(base)) return null;
  const suffix = (match[2] ?? '').toLowerCase();
  const mult = suffix === 'k' ? 1e3 : suffix === 'm' ? 1e6 : suffix === 'b' ? 1e9 : 1;
  return Math.round(base * mult);
}

/** Finite integer or `0` — for DTO fields typed as a bare `number`. */
export function toIntOr(value: unknown, fallback: number): number {
  const n = toNumberOrNull(value);
  return n == null ? fallback : Math.trunc(n);
}

export function toBool(value: unknown): boolean {
  return value === true;
}

/** `//host/path` → `https://host/path`; leaves absolute URLs untouched. */
export function normalizeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value.startsWith('//')) return `https:${value}`;
  return value;
}

/**
 * Apply a `(URL) => URL` rewriter to a raw URL string. Returns the rewritten
 * string, or the normalized original if it can't be parsed (never throws).
 */
export function rewriteUrl(value: unknown, rewriter: (url: URL) => URL): string | null {
  const normalized = normalizeUrl(value);
  if (normalized == null) return null;
  try {
    return rewriter(new URL(normalized)).toString();
  } catch {
    return normalized;
  }
}

/**
 * googlevideo URLs carry an `expire` query param (unix seconds). Returns epoch
 * ms, or `fallbackMs` from now when absent/unparseable.
 */
export function expiresAtFromUrl(rawUrl: unknown, fallbackMs: number): number {
  const normalized = normalizeUrl(rawUrl);
  if (normalized != null) {
    try {
      const expire = new URL(normalized).searchParams.get('expire');
      const seconds = expire == null ? null : Number(expire);
      if (seconds != null && Number.isFinite(seconds) && seconds > 0) {
        return Math.trunc(seconds * 1000);
      }
    } catch {
      // fall through
    }
  }
  return Date.now() + fallbackMs;
}
