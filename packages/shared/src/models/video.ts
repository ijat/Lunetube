import type { ChannelRef } from './channel.js';
import type { TextTimestamp } from '../format.js';

export interface Chapter {
  title: string;
  startSec: number;
  endSec: number | null;
  thumbnailUrl?: string;
  /** `'sponsorblock'` chapters come from the SB API; `'youtube'` from the player bar / description. */
  source: 'youtube' | 'description' | 'sponsorblock';
}

export interface VideoSummary {
  id: string;
  title: string;
  channel: ChannelRef;
  durationSec: number | null;
  thumbnailUrl: string | null;
  publishedText: string | null;
  viewCount: number | null;
  isLive: boolean;
}

export interface VideoDetail extends VideoSummary {
  description: string;
  descriptionTimestamps: TextTimestamp[];
  likeCount: number | null;
  keywords: string[];
  category: string | null;
  chapters: Chapter[];
  /** Most-replayed heat-map peaks, normalised 0..1 over the timeline. */
  mostReplayed: { positionSec: number; intensity: number }[];
  isUpcoming: boolean;
}
