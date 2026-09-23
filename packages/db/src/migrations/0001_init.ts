import type { Migration } from '../migrate.js';

/**
 * Schema v1 (A25) — plan.md "Schema v1 (final)". FROZEN once Phase 3 merges: a schema change is a
 * new migration, never an edit here (the developer's own library will already have run this).
 *
 * Invariants the repositories (P3-3) keep on top of it: `position` is dense 0..n-1 per list;
 * no `videos` row survives unreferenced by history ∪ playlist_items ∪ queue (orphan GC in every
 * removal transaction); the seeded Watch Later row is never renamed or deleted. Image columns hold
 * upstream https URLs only — never a per-launch proxy URL (A26); video thumbnails are not stored.
 */
export const m0001_init: Migration = {
  version: 1,
  name: 'init',
  sql: `
CREATE TABLE videos (            -- denormalised snapshot so the library renders offline
  id TEXT PRIMARY KEY, title TEXT NOT NULL,
  channel_id TEXT NOT NULL DEFAULT '', channel_name TEXT NOT NULL DEFAULT '',
  channel_avatar TEXT,           -- UPSTREAM https URL (allow-listed) or NULL, never a proxy URL (A26)
  duration_sec INTEGER, published_text TEXT, view_count INTEGER,
  is_live INTEGER NOT NULL DEFAULT 0 CHECK (is_live IN (0,1)),
  updated_at INTEGER NOT NULL) STRICT;
CREATE TABLE history (
  video_id TEXT PRIMARY KEY REFERENCES videos(id), watched_at INTEGER NOT NULL,
  position_sec REAL NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1))) STRICT;
CREATE INDEX history_watched_at ON history(watched_at DESC, video_id);
CREATE TABLE playlists (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('user','watch_later')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL) STRICT;
CREATE UNIQUE INDEX playlists_one_watch_later ON playlists(kind) WHERE kind = 'watch_later';
CREATE TABLE playlist_items (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id), position INTEGER NOT NULL, added_at INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, video_id)) STRICT;
CREATE INDEX playlist_items_order ON playlist_items(playlist_id, position);
CREATE INDEX playlist_items_video ON playlist_items(video_id);
CREATE TABLE queue (
  video_id TEXT PRIMARY KEY REFERENCES videos(id), position INTEGER NOT NULL, added_at INTEGER NOT NULL) STRICT;
CREATE INDEX queue_order ON queue(position);
CREATE TABLE queue_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_video_id TEXT REFERENCES queue(video_id) ON DELETE SET NULL) STRICT;
INSERT INTO queue_state(id, current_video_id) VALUES (1, NULL);
CREATE TABLE follows (
  channel_id TEXT PRIMARY KEY, name TEXT NOT NULL, handle TEXT, avatar_url TEXT,  -- avatar: upstream only
  followed_at INTEGER NOT NULL) STRICT;
CREATE TABLE feed_items (          -- the fan-out cache; not exported
  channel_id TEXT NOT NULL REFERENCES follows(channel_id) ON DELETE CASCADE,
  video_id TEXT NOT NULL, title TEXT NOT NULL, published_at INTEGER NOT NULL, view_count INTEGER,
  is_short INTEGER NOT NULL DEFAULT 0 CHECK (is_short IN (0,1)),
  PRIMARY KEY (channel_id, video_id)) STRICT;
CREATE INDEX feed_items_published ON feed_items(published_at DESC);
CREATE TABLE feed_state (
  channel_id TEXT PRIMARY KEY REFERENCES follows(channel_id) ON DELETE CASCADE,
  fetched_at INTEGER, next_attempt_at INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0, last_error TEXT) STRICT;
INSERT INTO playlists(id, name, kind, created_at, updated_at)
  VALUES ('watch-later', 'Watch Later', 'watch_later', unixepoch()*1000, unixepoch()*1000);
`,
};
