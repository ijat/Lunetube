import { join } from 'node:path';
import { app, BrowserWindow, dialog, session } from 'electron';
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

  app
    .whenReady()
    .then(async () => {
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

      // Registered only after the first window and every IPC handler exist. It
      // must NOT be registered earlier: `createMainWindow` has no idempotency
      // guard, so an `activate` firing during `await startProxy(...)` would spawn
      // a window before `registerYoutubeIpc` (its `yt:*` invokes would reject)
      // and the startup chain would then spawn a second, orphaning the first.
      // The early registration bought nothing anyway — the `.catch` below calls
      // `app.exit(1)`, so there is no windowless-but-alive process for a macOS
      // dock click to recover before startup completes.
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) spawnWindow();
      });
    })
    .catch((cause: unknown) => {
      // A failed loopback bind (a locked-down host, an EDR product refusing
      // 127.0.0.1:0, an exhausted ephemeral range) would otherwise leave a
      // running process with no window and no IPC — silent and undiagnosable.
      dialog.showErrorBox(
        'LuneTube failed to start',
        cause instanceof Error ? cause.message : String(cause),
      );
      app.exit(1);
    });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
