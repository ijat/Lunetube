/**
 * The renderer CSP (`apps/desktop/src/main/security.ts`) allows images only from
 * `'self' data: blob: http://127.0.0.1:*`. YouTube thumbnails and avatars must
 * therefore reach the renderer **already rewritten to the loopback `/img`
 * proxy** — `packages/youtube` maps them through the injected image rewriter
 * (`getVideo` / `getRelated`). Anything still pointing at an upstream `https:`
 * host cannot be shown and callers must fall back to a placeholder; this is the
 * normal case under `LUNE_FAKE_YT=1`, where the fake source uses an identity
 * rewriter.
 *
 * Routing images through the same-origin-ish proxy is also what keeps the
 * dominant-colour canvas read untainted (a cross-origin image without CORS makes
 * `getImageData` throw) — the `/img` route sets `Access-Control-Allow-Origin` to
 * the renderer origin.
 */
const LOOPBACK_IMAGE = /^http:\/\/127\.0\.0\.1:\d+\//;

/** The URL if it is a loopback-proxy image URL the renderer may load, else `null`. */
export function loopbackImage(url: string | null | undefined): string | null {
  return typeof url === 'string' && LOOPBACK_IMAGE.test(url) ? url : null;
}
