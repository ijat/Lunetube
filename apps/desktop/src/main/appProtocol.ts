import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { protocol } from 'electron';
import { PROD_CSP } from './security.js';

/**
 * Serves the built renderer from `app://bundle/…` in packaged builds so the
 * strict CSP's `script-src 'self'` has an unambiguous origin (a bare `file://`
 * page does not). Must be registered as privileged before `app` is ready.
 */
export const APP_SCHEME = 'app';
export const APP_ORIGIN = `${APP_SCHEME}://bundle`;

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json',
};

export interface ResolvedAsset {
  /** Absolute path, guaranteed to be inside `rendererDir`. */
  filePath: string;
  /** Lower-cased extension including the dot, or `''` when there is none. */
  ext: string;
}

/**
 * Pure URL → filesystem-path mapping for the `app://` handler (F9). Returns
 * `null` for an unparseable URL or any path that would escape `rendererDir`.
 * The containment guarantee is the `resolve()` + separator anchor, not a
 * prefix `startsWith` on an unnormalised join.
 */
export function resolveAssetPath(rendererDir: string, requestUrl: string): ResolvedAsset | null {
  let pathname: string;
  try {
    pathname = new URL(requestUrl).pathname;
  } catch {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  // Strip leading `/` and any `../` prefixes so the value can never be absolute
  // or climb out when handed to `resolve()`.
  const rel = normalize(decoded).replace(/^([/\\]|\.\.[/\\])+/, '');
  const target = rel === '' || rel === '.' ? 'index.html' : rel;
  const filePath = resolve(rendererDir, target);

  if (filePath !== rendererDir && !filePath.startsWith(rendererDir + sep)) {
    return null;
  }
  return { filePath, ext: extname(filePath).toLowerCase() };
}

export function registerAppProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

export function serveRenderer(rendererDir: string): void {
  const htmlHeaders = { 'content-type': 'text/html', 'content-security-policy': PROD_CSP };

  protocol.handle(APP_SCHEME, async (request) => {
    const asset = resolveAssetPath(rendererDir, request.url);
    if (!asset) return new Response('Bad Request', { status: 400 });

    try {
      const body = await readFile(asset.filePath);
      const headers: Record<string, string> =
        asset.ext === '.html'
          ? htmlHeaders
          : { 'content-type': MIME[asset.ext] ?? 'application/octet-stream' };
      return new Response(new Uint8Array(body), { headers });
    } catch {
      // SPA fallback only for navigable requests — a genuinely missing JS/CSS
      // asset must surface as a real 404, not as HTML the renderer then fails
      // to parse (F9).
      if (asset.ext === '' || asset.ext === '.html') {
        const html = await readFile(join(rendererDir, 'index.html'));
        return new Response(new Uint8Array(html), { headers: htmlHeaders });
      }
      return new Response('Not Found', { status: 404 });
    }
  });
}
