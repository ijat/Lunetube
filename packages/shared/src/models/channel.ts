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

/** The "About" tab of a channel page (plan P2-1 / A16). */
export interface ChannelAbout {
  description: string;
  joinedText: string | null;
  viewCountText: string | null;
  videoCountText: string | null;
  subscriberText: string | null;
  country: string | null;
  /** External links — opened via `app:openExternal`, never proxy-rewritten. */
  links: { title: string; url: string }[];
}
