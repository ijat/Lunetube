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
  "connect-src 'self' http://127.0.0.1:*",
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

  // Deny every permission except the two the player genuinely needs.
  session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'fullscreen' || permission === 'media');
  });
  session.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'fullscreen' || permission === 'media';
  });
}

export function hardenWindow(win: BrowserWindow, { appOrigin }: { appOrigin: string }): void {
  // External links open in the OS browser (https only); nothing spawns a window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Pin in-app navigation to the app origin.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(appOrigin)) event.preventDefault();
  });
}
