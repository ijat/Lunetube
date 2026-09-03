import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { Slider } from '@lunetube/design';
import { usePlayerStore } from '../usePlayerStore.js';

export interface VolumeControlProps {
  onVolume: (volume: number) => void;
  onToggleMuted: () => void;
}

/**
 * The mockup's volume icon + `.ctl .vol` bar. The bar is the design system's
 * `Slider` (a native `<input type=range>`, so it keeps free keyboard and
 * screen-reader behaviour) restyled to the mockup's 76×4px track by
 * `.player__vol` in `player.css`; the accent fill is driven by the `--vol`
 * custom property rather than a second element.
 */
export function VolumeControl({ onVolume, onToggleMuted }: VolumeControlProps) {
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const effective = muted ? 0 : volume;

  const Icon = effective === 0 ? VolumeX : effective < 0.5 ? Volume1 : Volume2;

  return (
    <div className="player__volume">
      <button
        type="button"
        className="player__ib"
        aria-label={muted ? 'Unmute' : 'Mute'}
        aria-pressed={muted}
        onClick={onToggleMuted}
      >
        <Icon size={20} strokeWidth={1.8} />
      </button>
      <Slider
        className="player__vol"
        aria-label="Volume"
        min={0}
        max={1}
        step={0.01}
        value={effective}
        onChange={onVolume}
        style={{ ['--vol' as string]: `${Math.round(effective * 100)}%` }}
      />
    </div>
  );
}
