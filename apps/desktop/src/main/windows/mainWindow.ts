import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { app, BrowserWindow, screen } from 'electron';
import type { WindowBounds, WindowState } from '@lunetube/shared';
import { hardenWindow } from '../security.js';

const TOPBAR_H = 44;
const MIN_WIDTH = 880;
const MIN_HEIGHT = 600;
const boundsPath = () => join(app.getPath('userData'), 'window-state.json');

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** True if the rect overlaps some connected display's work area (F3). */
function isOnSomeDisplay(b: WindowBounds): boolean {
  return screen.getAllDisplays().some((d) => {
    const w = d.workArea;
    return (
      b.x < w.x + w.width && b.x + b.width > w.x && b.y < w.y + w.height && b.y + b.height > w.y
    );
  });
}

/**
 * Restore persisted size always (clamped to the minimums); restore the position
 * only when all four bounds are finite AND the window would land on a currently
 * connected display — otherwise drop x/y and let Electron centre it, so a
 * frameless window can never restore fully off-screen after a monitor change.
 */
function loadBounds(): Partial<WindowBounds> | null {
  try {
    const b = JSON.parse(readFileSync(boundsPath(), 'utf8')) as Partial<WindowBounds>;
    if (!isNum(b.width) || !isNum(b.height)) return null;
    const size = {
      width: Math.max(MIN_WIDTH, Math.round(b.width)),
      height: Math.max(MIN_HEIGHT, Math.round(b.height)),
    };
    if (isNum(b.x) && isNum(b.y) && isOnSomeDisplay({ x: b.x, y: b.y, ...size })) {
      return { ...size, x: b.x, y: b.y };
    }
    return size;
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
  loadUrl: string;
  appOrigin: string;
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
    ...(saved && saved.x !== undefined && saved.y !== undefined ? { x: saved.x, y: saved.y } : {}),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
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

  hardenWindow(win, { appOrigin: opts.appOrigin });

  win.once('ready-to-show', () => win.show());
  win.on('close', () => saveBounds(win));
  win.on('closed', () => {
    mainWindow = null;
  });

  void win.loadURL(opts.loadUrl);

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
