import { join } from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import { installSessionSecurity } from './security.js';
import { createMainWindow, getMainWindow } from './windows/mainWindow.js';
import { registerAppIpc } from './ipc/app.js';

const isDev = !!process.env['ELECTRON_RENDERER_URL'];

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
    registerAppIpc();

    createMainWindow({
      preloadPath: join(__dirname, '../preload/index.js'),
      rendererUrl: process.env['ELECTRON_RENDERER_URL'],
      rendererFile: join(__dirname, '../renderer/index.html'),
      isDev,
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow({
          preloadPath: join(__dirname, '../preload/index.js'),
          rendererUrl: process.env['ELECTRON_RENDERER_URL'],
          rendererFile: join(__dirname, '../renderer/index.html'),
          isDev,
        });
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
