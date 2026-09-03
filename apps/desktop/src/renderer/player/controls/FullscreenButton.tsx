import { Maximize, Minimize } from 'lucide-react';
import { usePlayerStore } from '../usePlayerStore.js';

/**
 * Phase 1 uses the DOM Fullscreen API on the player container. PRD §5's eight
 * window/fullscreen modes (theater, borderless, monitor targeting, mini-player)
 * are Phase 4 and go through `win:setMode` in main — this button is deliberately
 * only the plain case.
 */
export function FullscreenButton({ onToggle }: { onToggle: () => void }) {
  const fullscreen = usePlayerStore((s) => s.fullscreen);
  return (
    <button
      type="button"
      className="player__ib"
      aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      aria-pressed={fullscreen}
      onClick={onToggle}
    >
      {fullscreen ? (
        <Minimize size={20} strokeWidth={1.8} />
      ) : (
        <Maximize size={20} strokeWidth={1.8} />
      )}
    </button>
  );
}
