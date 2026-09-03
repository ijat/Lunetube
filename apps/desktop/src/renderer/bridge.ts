import type { LuneBridge } from '@lunetube/shared';

/**
 * Accessor for the preload bridge (F13). If preload failed to load — the most
 * common Electron packaging regression — `window.lune` is `undefined`; every
 * call site then throws a clear, greppable error instead of
 * `Cannot read properties of undefined`.
 */
export function bridge(): LuneBridge {
  const b = window.lune;
  if (!b) throw new Error('preload bridge (window.lune) is missing — preload failed to load');
  return b;
}

/** Non-throwing check for render-time branching (e.g. an error screen). */
export function hasBridge(): boolean {
  return Boolean(window.lune);
}
