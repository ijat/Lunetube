/** Minimal channel reference embedded in video cards, comments, etc. */
export interface ChannelRef {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export type ChannelTab = 'videos' | 'shorts' | 'playlists' | 'about' | 'live' | 'podcasts';

export interface ChannelDetail extends ChannelRef {
  handle: string | null;
  subscriberText: string | null;
  bannerUrl: string | null;
  description: string;
  videoCount: number | null;
  isVerified: boolean;
  availableTabs: ChannelTab[];
}
