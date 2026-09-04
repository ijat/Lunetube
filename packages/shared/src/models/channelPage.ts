import type { ChannelAbout, ChannelDetail, ChannelTab } from './channel.js';
import type { PlaylistRef } from './playlist.js';
import type { VideoSummary } from './video.js';

/**
 * The discriminated payload of one channel tab (plan P2-1 / A16). A separate
 * file from `channel.ts` so that module needn't import `video.ts` (which already
 * imports `channel.ts`).
 */
export type ChannelTabContent =
  | { kind: 'videos'; items: VideoSummary[] }
  | { kind: 'playlists'; items: PlaylistRef[] }
  | { kind: 'about'; about: ChannelAbout };

export interface ChannelPage {
  /** Present only on a first page — a continuation response carries no channel header. */
  channel?: ChannelDetail;
  tab: ChannelTab;
  content: ChannelTabContent;
  continuation?: string;
}
