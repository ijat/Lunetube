/**
 * Thumbnail selection. Pure — no I/O. YouTube returns an array of
 * `{ url, width, height }` (youtubei.js `Thumbnail`); we pick the best one and
 * optionally route it through the `/img` proxy so the renderer can read the
 * pixels from a same-origin canvas (dominant-colour wash, PRD §7).
 */
import { normalizeUrl, rewriteUrl, toNumberOrNull } from './util.js';

export interface RawThumbnail {
  url?: unknown;
  width?: unknown;
  height?: unknown;
}

function area(t: RawThumbnail): number {
  const w = toNumberOrNull(t.width) ?? 0;
  const h = toNumberOrNull(t.height) ?? 0;
  return w * h;
}

/** Largest thumbnail whose width is ≤ `maxWidth` (if given), else the largest overall. */
export function pickThumbnail(
  thumbnails: readonly RawThumbnail[] | null | undefined,
  opts: { maxWidth?: number } = {},
): RawThumbnail | null {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null;
  const withUrl = thumbnails.filter((t) => normalizeUrl(t.url) != null);
  if (withUrl.length === 0) return null;

  const { maxWidth } = opts;
  if (maxWidth != null) {
    const capped = withUrl
      .filter((t) => (toNumberOrNull(t.width) ?? 0) <= maxWidth)
      .sort((a, b) => area(b) - area(a));
    if (capped[0] != null) return capped[0];
  }
  return [...withUrl].sort((a, b) => area(b) - area(a))[0] ?? null;
}

/** Best thumbnail URL as a plain string, or `null`. */
export function pickThumbnailUrl(
  thumbnails: readonly RawThumbnail[] | null | undefined,
  opts: { maxWidth?: number } = {},
): string | null {
  const picked = pickThumbnail(thumbnails, opts);
  return picked == null ? null : normalizeUrl(picked.url);
}

/** Best thumbnail URL routed through an image rewriter (the `/img` proxy route). */
export function pickThumbnailUrlRewritten(
  thumbnails: readonly RawThumbnail[] | null | undefined,
  rewriter: (url: URL) => URL,
  opts: { maxWidth?: number } = {},
): string | null {
  const picked = pickThumbnail(thumbnails, opts);
  return picked == null ? null : rewriteUrl(picked.url, rewriter);
}
