import { join } from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import { installSessionSecurity } from './security.js';
import { APP_ORIGIN, registerAppProtocolScheme, serveRenderer } from './appProtocol.js';
import { createMainWindow, getMainWindow } from './windows/mainWindow.js';
import { registerAppIpc } from './ipc/app.js';

const devUrl = process.env['ELECTRON_RENDERER_URL'];
const isDev = !!devUrl;

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

  app.whenReady().then(() => {
    app.setName('LuneTube');
    installSessionSecurity(session.defaultSession, { isDev });
    if (!isDev) serveRenderer(join(__dirname, '../renderer'));
    registerAppIpc();
    spawnWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) spawnWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
