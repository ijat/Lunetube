/**
 * Adapter DTO for `YouTubeSource.getChannelUploads` (P3-5) — the channel-RSS
 * fan-out source for "latest from followed" (P3-F11). No duration field: the
 * RSS feed does not carry one.
 */
export interface UploadItem {
  videoId: string;
  title: string;
  publishedAt: number;
  viewCount: number | null;
  isShort: boolean;
}

export interface ChannelUploads {
  channelId: string;
  channelTitle: string | null;
  items: UploadItem[];
}
