import { Pause, Play } from 'lucide-react';
import { usePlayerStore } from '../usePlayerStore.js';

/** The mockup's `.ctl .row .ib.play` — 26px glyph, filled, no stroke. */
export function PlayPause({ onToggle }: { onToggle: () => void }) {
  const paused = usePlayerStore((s) => s.paused);
  return (
    <button
      type="button"
      className="player__ib player__ib--play"
      aria-label={paused ? 'Play' : 'Pause'}
      onClick={onToggle}
    >
      {paused ? (
        <Play size={26} fill="currentColor" strokeWidth={0} />
      ) : (
        <Pause size={26} fill="currentColor" strokeWidth={0} />
      )}
    </button>
  );
}
