import { shell, type BrowserWindow, type Session } from 'electron';

/**
 * Renderer trust boundary (PRD §8). The strict CSP is applied in packaged builds
 * only; in `electron-vite dev` the renderer is served over http with HMR, which
 * needs a looser policy.
 */
export const PROD_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob: http://127.0.0.1:*",
  "media-src 'self' blob: http://127.0.0.1:*",
  // `blob:` is required by P1-5: `PlaybackEngine` hands shaka the DASH manifest
  // as an object URL (`URL.createObjectURL`), and shaka *fetches* that URL —
  // which CSP scores against `connect-src`, where `'self'` deliberately does
  // NOT cover `blob:`. Without this the player cannot load anything in a
  // packaged build. The grant is narrow: a `blob:` URL is only ever minted by
  // this renderer from bytes it already holds, so it adds no new network reach.
  "connect-src 'self' blob: http://127.0.0.1:*",
].join('; ');

export function installSessionSecurity(session: Session, { isDev }: { isDev: boolean }): void {
  if (!isDev) {
    session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [PROD_CSP],
        },
      });
    });
  }

  // Deny every permission except the one the player genuinely needs. `'media'`
  // is the getUserMedia capture grant (camera/mic) — never needed for <video>
  // playback of proxied/blob media, so it stays denied (F5).
  session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'fullscreen');
  });
  session.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'fullscreen';
  });
}

/** Origin of a URL as `protocol//host` — works for non-special schemes like
 * `app:` where `URL.origin` is the opaque string `"null"` (F6). */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export function hardenWindow(win: BrowserWindow, { appOrigin }: { appOrigin: string }): void {
  // External links open in the OS browser (https only); nothing spawns a window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Pin in-app navigation to the app origin (real origin comparison, not a
  // prefix test — `app://bundle.evil/` must not pass, F6).
  win.webContents.on('will-navigate', (event, url) => {
    if (originOf(url) !== appOrigin) event.preventDefault();
  });
}
