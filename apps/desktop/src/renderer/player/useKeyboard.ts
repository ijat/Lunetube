import { useEffect } from 'react';

/**
 * The Phase-1 keyboard subset (plan P1-5). The full PRD §6 set and the `?`
 * overlay are Phase 4 — deliberately not started here.
 *
 * | key            | action            |
 * |----------------|-------------------|
 * | `Space` / `K`  | play / pause      |
 * | `J` / `L`      | seek ∓10 s        |
 * | `←` / `→`      | seek ∓5 s         |
 * | `↑` / `↓`      | volume ±5 %       |
 * | `M`            | mute toggle       |
 * | `F`            | fullscreen toggle |
 */

export interface PlayerKeyboardHandlers {
  togglePlay: () => void;
  seekBy: (delta: number) => void;
  adjustVolume: (delta: number) => void;
  toggleMuted: () => void;
  toggleFullscreen: () => void;
}

const SEEK_SMALL = 5;
const SEEK_LARGE = 10;
const VOLUME_STEP = 0.05;

/** Keys the focused element would otherwise handle itself. */
const NATIVELY_HANDLED = new Set([
  ' ',
  'Spacebar',
  'Enter',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
]);

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * A button, link, slider or menu item: it owns Space/Enter/arrows while
 * focused, so stealing them would double-fire (Space on the focused play button
 * would toggle twice). Every other shortcut still applies.
 */
function isInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button, a[href], [role="slider"], [role="menuitem"], summary'));
}

export function usePlayerKeyboard(handlers: PlayerKeyboardHandlers, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      // Never shadow an OS/app accelerator (Cmd-R, Ctrl-F, Alt-Left, …).
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTextEntry(event.target)) return;
      if (NATIVELY_HANDLED.has(event.key) && isInteractive(event.target)) return;

      switch (event.key) {
        case ' ':
        case 'Spacebar':
        case 'k':
        case 'K':
          handlers.togglePlay();
          break;
        case 'j':
        case 'J':
          handlers.seekBy(-SEEK_LARGE);
          break;
        case 'l':
        case 'L':
          handlers.seekBy(SEEK_LARGE);
          break;
        case 'ArrowLeft':
          handlers.seekBy(-SEEK_SMALL);
          break;
        case 'ArrowRight':
          handlers.seekBy(SEEK_SMALL);
          break;
        case 'ArrowUp':
          handlers.adjustVolume(VOLUME_STEP);
          break;
        case 'ArrowDown':
          handlers.adjustVolume(-VOLUME_STEP);
          break;
        case 'm':
        case 'M':
          handlers.toggleMuted();
          break;
        case 'f':
        case 'F':
          handlers.toggleFullscreen();
          break;
        default:
          return;
      }
      // Only reached when a case matched: stop Space scrolling the page and
      // stop the arrows moving focus.
      event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers, enabled]);
}
