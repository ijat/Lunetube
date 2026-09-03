import type { VideoSummary } from './video.js';
import type { ChannelDetail } from './channel.js';
import type { PlaylistRef } from './playlist.js';

/** youtubei.js exposes only RELEVANCE / POPULARITY (plan F2 + decision A3). */
export type SearchSort = 'relevance' | 'views';
export type SearchUploadDate = 'any' | 'hour' | 'today' | 'week' | 'month' | 'year';
export type SearchDuration = 'any' | 'short' | 'medium' | 'long';
export type SearchResultType = 'all' | 'video' | 'channel' | 'playlist';

export interface SearchFilters {
  sort: SearchSort;
  uploadDate: SearchUploadDate;
  duration: SearchDuration;
  type: SearchResultType;
}

export const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  sort: 'relevance',
  uploadDate: 'any',
  duration: 'any',
  type: 'all',
};

export type SearchResultItem =
  | { kind: 'video'; video: VideoSummary }
  | { kind: 'channel'; channel: ChannelDetail }
  | { kind: 'playlist'; playlist: PlaylistRef };

export interface SearchPage {
  items: SearchResultItem[];
  continuation?: string;
  estimatedResults: number | null;
}
