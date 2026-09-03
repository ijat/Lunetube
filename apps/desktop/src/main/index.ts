import { join } from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import { installSessionSecurity } from './security.js';
import { APP_ORIGIN, registerAppProtocolScheme, serveRenderer } from './appProtocol.js';
import { createMainWindow, getMainWindow } from './windows/mainWindow.js';
import { registerAppIpc } from './ipc/app.js';
import { registerYoutubeIpc } from './ipc/youtube.js';
import { startProxy } from './proxy/index.js';
import { initContainer } from './services/container.js';
import { getSettings } from './settings.js';

const devUrl = process.env['ELECTRON_RENDERER_URL'];
const isDev = !!devUrl;

// Must run before anything reads `app.getPath('userData')` (F16): the default
// name comes from package.json `name` (`@lunetube/desktop`, which has a slash),
// and Electron resolves the userData path early.
app.setName('LuneTube');

if (!isDev) registerAppProtocolScheme();

function spawnWindow(): void {
  createMainWindow({
    preloadPath: join(__dirname, '../preload/index.js'),
    loadUrl: isDev ? devUrl! : `${APP_ORIGIN}/index.html`,
    appOrigin: isDev ? new URL(devUrl!).origin : APP_ORIGIN,
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    installSessionSecurity(session.defaultSession, { isDev });
    if (!isDev) serveRenderer(join(__dirname, '../renderer'));

    // The media proxy must be up before the container so the YouTube adapter
    // can be handed rewriters that point at it. `close()` is idempotent.
    const rendererOrigin = isDev ? new URL(devUrl!).origin : APP_ORIGIN;
    const proxy = await startProxy({
      allowedOrigin: rendererOrigin,
      cacheDir: join(app.getPath('userData'), 'thumbs'),
      imageCacheBytes: Math.round(getSettings().thumbnailCacheMb * 1024 * 1024),
    });
    app.on('before-quit', () => {
      void proxy.close();
    });

    initContainer({ proxy });
    registerAppIpc();
    registerYoutubeIpc();
    spawnWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) spawnWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
