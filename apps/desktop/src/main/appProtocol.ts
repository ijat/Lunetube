import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
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

export function registerAppProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

export function serveRenderer(rendererDir: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const { pathname } = new URL(request.url);
    const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    const filePath = join(rendererDir, rel === '/' || rel === '' ? 'index.html' : rel);

    if (!filePath.startsWith(rendererDir)) {
      return new Response('Forbidden', { status: 403 });
    }

    const htmlHeaders = { 'content-type': 'text/html', 'content-security-policy': PROD_CSP };
    try {
      const body = await readFile(filePath);
      const ext = filePath.slice(filePath.lastIndexOf('.'));
      const contentType = MIME[ext] ?? 'application/octet-stream';
      const headers: Record<string, string> =
        ext === '.html' ? htmlHeaders : { 'content-type': contentType };
      return new Response(new Uint8Array(body), { headers });
    } catch {
      // SPA fallback so deep links work.
      const html = await readFile(join(rendererDir, 'index.html'));
      return new Response(new Uint8Array(html), { headers: htmlHeaders });
    }
  });
}
