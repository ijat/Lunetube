import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { app, BrowserWindow, screen } from 'electron';
import type { WindowBounds, WindowState } from '@lunetube/shared';
import { hardenWindow } from '../security.js';

const TOPBAR_H = 44;
const boundsPath = () => join(app.getPath('userData'), 'window-state.json');

function loadBounds(): WindowBounds | null {
  try {
    const b = JSON.parse(readFileSync(boundsPath(), 'utf8')) as WindowBounds;
    if ([b.x, b.y, b.width, b.height].every((n) => typeof n === 'number')) return b;
  } catch {
    /* first launch */
  }
  return null;
}

function saveBounds(win: BrowserWindow): void {
  if (win.isDestroyed() || win.isMinimized()) return;
  const p = boundsPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(win.getBounds()));
}

export interface CreateWindowOptions {
  preloadPath: string;
  rendererUrl: string | undefined;
  rendererFile: string;
  isDev: boolean;
}

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function createMainWindow(opts: CreateWindowOptions): BrowserWindow {
  const saved = loadBounds();
  const win = new BrowserWindow({
    width: saved?.width ?? 1280,
    height: saved?.height ?? 820,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    minWidth: 880,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: '#0a0d13',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 14, y: (TOPBAR_H - 16) / 2 } }
      : {
          titleBarOverlay: { color: '#0a0d13', symbolColor: '#cbd5e1', height: TOPBAR_H },
        }),
    webPreferences: {
      preload: opts.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  hardenWindow(win, { appOrigin: opts.rendererUrl ?? 'file://' });

  win.once('ready-to-show', () => win.show());
  win.on('close', () => saveBounds(win));
  win.on('closed', () => {
    mainWindow = null;
  });

  if (opts.rendererUrl) {
    void win.loadURL(opts.rendererUrl);
  } else {
    void win.loadFile(opts.rendererFile);
  }

  mainWindow = win;
  return win;
}

export function currentWindowState(): WindowState {
  const win = mainWindow;
  if (!win || win.isDestroyed()) {
    return {
      mode: 'normal',
      displayId: null,
      bounds: null,
      isFullscreen: false,
      alwaysOnTop: false,
    };
  }
  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  return {
    mode: win.isMaximized() ? 'maximized' : win.isFullScreen() ? 'exclusive-fullscreen' : 'normal',
    displayId: display.id,
    bounds,
    isFullscreen: win.isFullScreen(),
    alwaysOnTop: win.isAlwaysOnTop(),
  };
}
