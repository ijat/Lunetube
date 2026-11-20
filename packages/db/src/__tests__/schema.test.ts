import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WATCH_LATER_ID } from '@lunetube/shared';
import { sqliteErrorCode, type SqlDb } from '../driver.js';
import { readUserVersion } from '../migrate.js';
import { SCHEMA_VERSION } from '../migrations/index.js';
import { openMemoryDb } from '../testing.js';

let db: SqlDb;
beforeEach(() => {
  db = openMemoryDb();
});
afterEach(() => {
  db.close();
});

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
  } catch (e) {
    return sqliteErrorCode(e);
  }
  return 'NO_ERROR';
}

const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;

function video(id: string): void {
  db.prepare('INSERT INTO videos (id, title, updated_at) VALUES (?, ?, ?)').run(id, `t-${id}`, 1);
}

function follow(channelId: string): void {
  db.prepare('INSERT INTO follows (channel_id, name, followed_at) VALUES (?, ?, ?)').run(
    channelId,
    'n',
    1,
  );
}

describe('schema v1', () => {
  it('is at SCHEMA_VERSION with exactly the v1 tables, all STRICT', () => {
    expect(readUserVersion(db)).toBe(SCHEMA_VERSION);
    const tables = db
      .prepare(
        "SELECT name, strict FROM pragma_table_list WHERE schema = 'main' AND type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();
    expect(tables).toEqual(
      [
        'feed_items',
        'feed_state',
        'follows',
        'history',
        'playlist_items',
        'playlists',
        'queue',
        'queue_state',
        'videos',
      ].map((name) => ({ name, strict: 1 })),
    );
  });

  it('seeds the Watch Later playlist (the shared WATCH_LATER_ID) and the queue_state singleton', () => {
    const wl = db.prepare('SELECT id, name, kind, created_at FROM playlists').all() as {
      id: string;
      name: string;
      kind: string;
      created_at: number;
    }[];
    expect(wl).toHaveLength(1);
    expect(wl[0]).toMatchObject({ id: WATCH_LATER_ID, name: 'Watch Later', kind: 'watch_later' });
    // unixepoch()*1000 → epoch milliseconds, i.e. roughly now.
    expect(Math.abs((wl[0]?.created_at ?? 0) - Date.now())).toBeLessThan(60_000);
    expect(db.prepare('SELECT id, current_video_id FROM queue_state').all()).toEqual([
      { id: 1, current_video_id: null },
    ]);
  });

  it('STRICT tables reject wrong types', () => {
    expect(
      codeOf(() =>
        db.prepare("INSERT INTO videos (id, title, updated_at) VALUES ('a', 'b', 'soon')").run(),
      ),
    ).toBe('SQLITE_CONSTRAINT_DATATYPE');
  });

  it('CHECK constraints hold (boolean columns, playlist kind, queue_state singleton)', () => {
    expect(
      codeOf(() =>
        db
          .prepare("INSERT INTO videos (id, title, updated_at, is_live) VALUES ('a', 'b', 1, 2)")
          .run(),
      ),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(
      codeOf(() =>
        db
          .prepare(
            "INSERT INTO playlists (id, name, kind, created_at, updated_at) VALUES ('x', 'x', 'liked', 1, 1)",
          )
          .run(),
      ),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(codeOf(() => db.prepare('INSERT INTO queue_state (id) VALUES (2)').run())).toBe(
      'SQLITE_CONSTRAINT_CHECK',
    );
  });

  it('allows exactly one watch_later playlist, any number of user playlists', () => {
    const ins = db.prepare(
      'INSERT INTO playlists (id, name, kind, created_at, updated_at) VALUES (?, ?, ?, 1, 1)',
    );
    expect(codeOf(() => ins.run('wl2', 'Again', 'watch_later'))).toBe('SQLITE_CONSTRAINT_UNIQUE');
    ins.run('u1', 'A', 'user');
    ins.run('u2', 'B', 'user');
    expect(count('SELECT count(*) AS n FROM playlists')).toBe(3);
  });

  it('enforces foreign keys (history → videos)', () => {
    expect(
      codeOf(() =>
        db.prepare("INSERT INTO history (video_id, watched_at) VALUES ('nope', 1)").run(),
      ),
    ).toBe('SQLITE_CONSTRAINT_FOREIGNKEY');
  });

  it('removing the current queue row nulls queue_state.current_video_id', () => {
    video('v1');
    db.prepare("INSERT INTO queue (video_id, position, added_at) VALUES ('v1', 0, 1)").run();
    db.prepare("UPDATE queue_state SET current_video_id = 'v1'").run();
    db.prepare("DELETE FROM queue WHERE video_id = 'v1'").run();
    expect(db.prepare('SELECT current_video_id FROM queue_state').get()).toEqual({
      current_video_id: null,
    });
  });

  it('deleting a playlist cascades to its items', () => {
    video('v1');
    db.prepare(
      "INSERT INTO playlists (id, name, kind, created_at, updated_at) VALUES ('p', 'P', 'user', 1, 1)",
    ).run();
    db.prepare(
      "INSERT INTO playlist_items (playlist_id, video_id, position, added_at) VALUES ('p', 'v1', 0, 1)",
    ).run();
    db.prepare("DELETE FROM playlists WHERE id = 'p'").run();
    expect(count('SELECT count(*) AS n FROM playlist_items')).toBe(0);
  });

  it('unfollowing cascades to the feed cache and feed state', () => {
    follow('UCaaaaaaaaaaaaaaaaaaaaaa');
    db.prepare(
      "INSERT INTO feed_items (channel_id, video_id, title, published_at) VALUES ('UCaaaaaaaaaaaaaaaaaaaaaa', 'v', 't', 1)",
    ).run();
    db.prepare("INSERT INTO feed_state (channel_id) VALUES ('UCaaaaaaaaaaaaaaaaaaaaaa')").run();
    db.prepare("DELETE FROM follows WHERE channel_id = 'UCaaaaaaaaaaaaaaaaaaaaaa'").run();
    expect(count('SELECT count(*) AS n FROM feed_items')).toBe(0);
    expect(count('SELECT count(*) AS n FROM feed_state')).toBe(0);
  });

  it('has the ordering / lookup indexes the repositories rely on', () => {
    const names = (
      db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'index' AND sql IS NOT NULL ORDER BY name",
        )
        .all() as { name: string }[]
    ).map((r) => r.name);
    expect(names).toEqual([
      'feed_items_published',
      'history_watched_at',
      'playlist_items_order',
      'playlist_items_video',
      'playlists_one_watch_later',
      'queue_order',
    ]);
  });
});
