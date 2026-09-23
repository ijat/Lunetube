import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupDb, deleteBackups } from '../backup.js';
import { openSqlite, type SqlDb } from '../driver.js';
import { readUserVersion } from '../migrate.js';

const isWin = process.platform === 'win32';
const T0 = Date.UTC(2026, 8, 23, 3, 4, 5); // 20260923T030405Z

let dir: string;
const open: SqlDb[] = [];
function track(db: SqlDb): SqlDb {
  open.push(db);
  return db;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lunetube-db-backup-'));
});
afterEach(() => {
  // Close before removing the dir (Windows EBUSY).
  for (const db of open.splice(0)) if (db.open) db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A WAL-mode file DB whose latest rows live only in the WAL (autocheckpoint off). */
function walDb(): SqlDb {
  const db = track(openSqlite(join(dir, 'lunetube.db')));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA wal_autocheckpoint = 0');
  db.exec(
    'CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1), (2), (3); PRAGMA user_version = 4',
  );
  return db;
}

function backups(): string[] {
  return readdirSync(dir)
    .filter((n) => n.startsWith('lunetube.db.bak-'))
    .sort();
}

describe('backupDb', () => {
  it('snapshots committed WAL content and user_version, 0600, named by kind + UTC stamp', () => {
    const db = walDb();
    const path = backupDb(db, dir, 'v4', T0);
    expect(path).toBe(join(dir, 'lunetube.db.bak-v4-20260923T030405Z'));

    const snap = track(openSqlite(path, { readonly: true, fileMustExist: true }));
    expect(readUserVersion(snap)).toBe(4);
    expect(snap.prepare('SELECT count(*) AS n FROM t').get()).toEqual({ n: 3 });
    if (!isWin) expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('suffixes -2, -3 on a name collision and prunes by (stamp, suffix), newest two kept', () => {
    const db = walDb();
    const a = backupDb(db, dir, 'v1', T0);
    const b = backupDb(db, dir, 'v1', T0);
    expect(b).toBe(`${a}-2`);
    expect(backups()).toEqual([
      'lunetube.db.bak-v1-20260923T030405Z',
      'lunetube.db.bak-v1-20260923T030405Z-2',
    ]);

    const c = backupDb(db, dir, 'v1', T0);
    expect(c).toBe(`${a}-3`);
    // The un-suffixed original is the oldest of the three.
    expect(backups()).toEqual([
      'lunetube.db.bak-v1-20260923T030405Z-2',
      'lunetube.db.bak-v1-20260923T030405Z-3',
    ]);
  });

  it('keeps the newest two per kind; migration kinds (v*) prune together, import separately', () => {
    const db = walDb();
    backupDb(db, dir, 'import', T0);
    backupDb(db, dir, 'v1', T0 + 1000);
    backupDb(db, dir, 'v1', T0 + 2000);
    backupDb(db, dir, 'v1', T0 + 3000);
    expect(backups()).toEqual([
      'lunetube.db.bak-import-20260923T030405Z',
      'lunetube.db.bak-v1-20260923T030407Z',
      'lunetube.db.bak-v1-20260923T030408Z',
    ]);

    backupDb(db, dir, 'v2', T0 + 4000);
    expect(backups()).toEqual([
      'lunetube.db.bak-import-20260923T030405Z',
      'lunetube.db.bak-v1-20260923T030408Z',
      'lunetube.db.bak-v2-20260923T030409Z',
    ]);

    backupDb(db, dir, 'import', T0 + 5000);
    backupDb(db, dir, 'import', T0 + 6000);
    expect(backups().filter((n) => n.includes('-import-'))).toEqual([
      'lunetube.db.bak-import-20260923T030410Z',
      'lunetube.db.bak-import-20260923T030411Z',
    ]);
    expect(backups().filter((n) => /-v\d+-/.test(n))).toHaveLength(2);
  });

  it('never touches the live file or unrelated files when pruning', () => {
    const db = walDb();
    writeFileSync(join(dir, 'notes.txt'), 'x');
    writeFileSync(join(dir, 'lunetube.db.bak-v1-garbage'), 'x');
    for (let i = 0; i < 4; i++) backupDb(db, dir, 'v1', T0 + i * 1000);
    expect(existsSync(join(dir, 'lunetube.db'))).toBe(true);
    expect(existsSync(join(dir, 'notes.txt'))).toBe(true);
    // Not a name backupDb produces, so pruning ignores it (deleteBackups still removes it).
    expect(existsSync(join(dir, 'lunetube.db.bak-v1-garbage'))).toBe(true);
  });

  it('rejects a kind that is not a plain [a-z0-9]+ token (it becomes part of a file name)', () => {
    const db = walDb();
    for (const kind of ['', '../x', 'v1/..', 'V1', 'a-b']) {
      expect(() => backupDb(db, dir, kind, T0)).toThrow(/invalid kind/);
    }
    expect(backups()).toEqual([]);
  });

  it('throws when the snapshot cannot be written (inside a transaction), leaving no file', () => {
    const db = walDb();
    db.exec('BEGIN');
    expect(() => backupDb(db, dir, 'v1', T0)).toThrow();
    db.exec('ROLLBACK');
    expect(backups()).toEqual([]);
  });
});

describe('deleteBackups', () => {
  it('removes every lunetube.db.bak-* and nothing else', () => {
    const db = walDb();
    backupDb(db, dir, 'v1', T0);
    backupDb(db, dir, 'import', T0);
    writeFileSync(join(dir, 'lunetube.db.bak-v1-garbage'), 'x');
    writeFileSync(join(dir, 'notes.txt'), 'x');
    expect(deleteBackups(dir)).toBe(3);
    expect(backups()).toEqual([]);
    expect(existsSync(join(dir, 'lunetube.db'))).toBe(true);
    expect(existsSync(join(dir, 'notes.txt'))).toBe(true);
    // The live DB is still usable.
    expect(db.prepare('SELECT count(*) AS n FROM t').get()).toEqual({ n: 3 });
  });

  it('returns 0 for a missing directory', () => {
    expect(deleteBackups(join(dir, 'nope'))).toBe(0);
  });
});
