import type { ChannelRef } from './channel.js';
import type { VideoSummary } from './video.js';

export interface PlaylistRef {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  videoCount: number | null;
}

export interface PlaylistDetail extends PlaylistRef {
  description: string;
  author: ChannelRef | null;
  lastUpdatedText: string | null;
  items: VideoSummary[];
  continuation?: string;
}
