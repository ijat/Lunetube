import type { ChannelRef } from './channel.js';
import type { VideoSummary } from './video.js';

/** The seeded, un-renameable, un-deletable Watch Later playlist (schema v1). */
export const WATCH_LATER_ID = 'watch-later';

const HISTORY_MAX = 50_000;
/** User-created playlists; Watch Later does not count against this. */
const PLAYLISTS_MAX = 100;
const PLAYLIST_ITEMS_MAX = 1_000;
const QUEUE_MAX = 500;

/**
 * Every library cap in one place — IPC validators, the migration seed and the
 * import path all read from here, so export -> import can only round-trip if
 * import stays no more permissive than the app itself ever writes.
 */
export const LIBRARY_LIMITS = {
  historyMax: HISTORY_MAX,
  playlistsMax: PLAYLISTS_MAX,
  playlistItemsMax: PLAYLIST_ITEMS_MAX,
  queueMax: QUEUE_MAX,
  followsMax: 1_000,
  nameMax: 100,
  titleMax: 500,
  channelNameMax: 200,
  historyQueryMax: 100,
  pageLimitMax: 200,
  queueAddMax: 500,
  /**
   * The most distinct videos a library can reference at once (history + every
   * playlist including Watch Later + the queue) — the import cap for
   * `videos[]`. Derived, not independently tunable.
   */
  videosMax: HISTORY_MAX + (PLAYLISTS_MAX + 1) * PLAYLIST_ITEMS_MAX + QUEUE_MAX,
  /**
   * ASSUMPTION: sized so the largest library the caps above allow (~150k video
   * snapshots) fits comfortably. Tunable, but must stay >= whatever the app can
   * actually export or export -> import stops round-tripping.
   */
  importFileMaxBytes: 64 * 1024 * 1024,
} as const;

export interface HistoryEntry {
  video: VideoSummary;
  watchedAt: number;
  positionSec: number;
  completed: boolean;
}

export interface HistoryPage {
  items: HistoryEntry[];
  nextCursor?: string;
}

export type LocalPlaylistKind = 'user' | 'watch_later';

export interface LocalPlaylistSummary {
  id: string;
  name: string;
  kind: LocalPlaylistKind;
  itemCount: number;
  createdAt: number;
  updatedAt: number;
  thumbnailUrl: string | null;
}

export interface LocalPlaylistItem {
  video: VideoSummary;
  addedAt: number;
}

export interface LocalPlaylistDetail extends LocalPlaylistSummary {
  items: LocalPlaylistItem[];
}

export interface QueueEntry {
  video: VideoSummary;
  addedAt: number;
}

export interface QueueState {
  items: QueueEntry[];
  currentVideoId: string | null;
}

export type QueueAddMode = 'next' | 'last' | 'replace';

export interface FollowedChannel {
  channel: ChannelRef;
  handle: string | null;
  followedAt: number;
  /** Set when the feed scheduler's last fetch for this channel failed (circuit breaker). */
  feedError: string | null;
}

export interface FeedItem {
  /**
   * `video.publishedText` is always `null` here — the renderer formats
   * `publishedAt` with the existing `formatRelativeDate` instead, since RSS
   * gives an exact timestamp the adapter would otherwise have to re-stringify.
   */
  video: VideoSummary;
  publishedAt: number;
}

export interface FeedPage {
  items: FeedItem[];
  followCount: number;
  refreshing: boolean;
  pausedUntil: number | null;
}

export type DbUnavailableReason = 'open-failed' | 'corrupt' | 'schema-newer' | 'migration-failed';

export interface DbStatus {
  state: 'ok' | 'unavailable';
  reason: DbUnavailableReason | null;
  message: string | null;
  path: string;
  schemaVersion: number | null;
  appSchemaVersion: number;
}

/** The `db:changed` event's scope — the renderer invalidates its cache by scope. */
export type DbScope = 'history' | 'playlists' | 'follows' | 'queue' | 'feed' | 'all';

/** Per-entity-kind counts, shared by `db:export`'s summary and `db:import`'s `added`. */
export interface LibraryCounts {
  videos: number;
  history: number;
  playlists: number;
  playlistItems: number;
  follows: number;
  queueItems: number;
}

export interface ImportSummary {
  added: LibraryCounts;
  skipped: number;
  /** Up to 5 human-readable reasons — never the raw offending record. */
  skippedReasons: string[];
}

/** `saved: false` means the user cancelled the save dialog — not an error. */
export type ExportResult = { saved: false } | { saved: true; path: string; counts: LibraryCounts };

/** `imported: false` means the user cancelled the open dialog — not an error. */
export type ImportResult = { imported: false } | { imported: true; summary: ImportSummary };
