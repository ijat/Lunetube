import { PLAYBACK_RATES } from '../PlaybackEngine.js';
import { usePlayerStore } from '../usePlayerStore.js';
import { PillMenu, type PillMenuOption } from './PillMenu.js';

export interface SpeedMenuProps {
  onSelect: (rate: number) => void;
}

const OPTIONS: PillMenuOption<number>[] = PLAYBACK_RATES.map((rate) => ({
  value: rate,
  label: `${rate}×`,
}));

/** The mockup's `1×` pill. */
export function SpeedMenu({ onSelect }: SpeedMenuProps) {
  const rate = usePlayerStore((s) => s.rate);

  return (
    <PillMenu<number>
      label="Playback speed"
      trigger={<span className="tnum">{rate}×</span>}
      options={OPTIONS}
      value={rate}
      onSelect={onSelect}
      hot={rate !== 1}
    />
  );
}
