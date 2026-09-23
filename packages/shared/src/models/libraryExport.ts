import type { LocalPlaylistKind } from './library.js';

export const LIBRARY_EXPORT_FORMAT = 'lunetube-library';
export const LIBRARY_EXPORT_VERSION = 1;

/** Denormalised video snapshot as stored — never a proxy URL (A26); no thumbnail (derived on read). */
export interface ExportVideo {
  id: string;
  title: string;
  channelId: string;
  channelName: string;
  /** Upstream https URL (allow-listed) or `null` — never a proxy URL. */
  channelAvatarUrl: string | null;
  durationSec: number | null;
  publishedText: string | null;
  viewCount: number | null;
  isLive: boolean;
  updatedAt: number;
}

export interface ExportHistory {
  videoId: string;
  watchedAt: number;
  positionSec: number;
  completed: boolean;
}

export interface ExportPlaylistItem {
  videoId: string;
  addedAt: number;
}

export interface ExportPlaylist {
  id: string;
  name: string;
  kind: LocalPlaylistKind;
  createdAt: number;
  updatedAt: number;
  items: ExportPlaylistItem[];
}

export interface ExportFollow {
  channelId: string;
  name: string;
  handle: string | null;
  /** Upstream https URL or `null`. */
  avatarUrl: string | null;
  followedAt: number;
}

export interface ExportQueueItem {
  videoId: string;
  addedAt: number;
}

/**
 * The whole-library JSON export/import format (`db:export` / `db:import`).
 *
 * **Arrays only — no id-keyed objects.** An importer that indexes a plain
 * object by an attacker-controlled key (an 11-char `[\w-]` video id like
 * `constructor` looks like a perfectly valid one) is how prototype confusion
 * happens; every collection here is a list, matched up by an explicit
 * `videoId` field instead. `feed_items` (the fan-out cache) is intentionally
 * not exported — it is disposable and re-derived from `follows`.
 */
export interface LibraryExportV1 {
  format: typeof LIBRARY_EXPORT_FORMAT;
  version: 1;
  exportedAt: number;
  appVersion: string;
  videos: ExportVideo[];
  history: ExportHistory[];
  playlists: ExportPlaylist[];
  follows: ExportFollow[];
  queue: {
    currentVideoId: string | null;
    items: ExportQueueItem[];
  };
}
