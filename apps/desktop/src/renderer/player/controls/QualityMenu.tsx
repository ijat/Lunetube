import { useMemo } from 'react';
import type { QualitySelection } from '../PlaybackEngine.js';
import { usePlayerStore } from '../usePlayerStore.js';
import { PillMenu, type PillMenuOption } from './PillMenu.js';

export interface QualityMenuProps {
  onSelect: (height: QualitySelection) => void;
}

/**
 * The mockup's `1080p` pill. Heights come from shaka's own `getVideoTracks()`
 * (via `PlaybackEngine`'s `onTracks`), not from `StreamManifest.video[]` —
 * shaka's list is the one that has been filtered down to what this Chromium
 * build can actually decode, so it never offers a resolution that would fail.
 */
export function QualityMenu({ onSelect }: QualityMenuProps) {
  const heights = usePlayerStore((s) => s.videoHeights);
  const activeHeight = usePlayerStore((s) => s.activeHeight);
  const selected = usePlayerStore((s) => s.selectedHeight);

  const options = useMemo<PillMenuOption<QualitySelection>[]>(
    () => [
      { value: 'auto', label: 'Auto' },
      ...heights.map((height) => ({ value: height, label: `${height}p` })),
    ],
    [heights],
  );

  const label =
    selected === 'auto'
      ? activeHeight === null
        ? 'Auto'
        : `Auto ${activeHeight}p`
      : `${selected}p`;

  return (
    <PillMenu<QualitySelection>
      label="Quality"
      trigger={<span className="tnum">{label}</span>}
      options={options}
      value={selected}
      onSelect={onSelect}
    />
  );
}
