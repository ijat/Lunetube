import { Segmented } from '@lunetube/design';
import type { ChannelTab } from '@lunetube/shared';

/**
 * The channel tab bar (plan P2-9) — renders **only** the tabs the adapter
 * reports in `ChannelDetail.availableTabs` (A16); an about-less channel never
 * shows an empty About tab. A fixed display order, since `availableTabs`
 * carries no guaranteed order of its own (`innertube/map/channel.ts`'s
 * `TAB_FLAGS` reads the underlying `has_*` getters in this order).
 */
const TAB_ORDER: readonly ChannelTab[] = [
  'videos',
  'shorts',
  'live',
  'playlists',
  'podcasts',
  'about',
];

const TAB_LABELS: Record<ChannelTab, string> = {
  videos: 'Videos',
  shorts: 'Shorts',
  live: 'Live',
  playlists: 'Playlists',
  podcasts: 'Podcasts',
  about: 'About',
};

export interface ChannelTabsProps {
  availableTabs: readonly ChannelTab[];
  activeTab: ChannelTab;
  onChange: (tab: ChannelTab) => void;
}

export function ChannelTabs({ availableTabs, activeTab, onChange }: ChannelTabsProps) {
  const options = TAB_ORDER.filter((tab) => availableTabs.includes(tab)).map((value) => ({
    value,
    label: TAB_LABELS[value],
  }));
  if (options.length === 0) return null;

  return (
    <Segmented
      className="chan-tabs"
      options={options}
      value={activeTab}
      onChange={onChange}
      ariaLabel="Channel tabs"
    />
  );
}
