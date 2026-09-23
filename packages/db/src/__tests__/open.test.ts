import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openSqlite, type SqlDb } from '../driver.js';
import { readUserVersion, type Migration } from '../migrate.js';
import { MIGRATIONS } from '../migrations/index.js';
import { closeLibraryDb, openLibraryDb, type OpenLibraryDbResult } from '../open.js';

const isWin = process.platform === 'win32';
const T0 = Date.UTC(2026, 8, 23, 3, 4, 5);

let root: string;
let dir: string;
let file: string;
const open: SqlDb[] = [];
const logs: string[] = [];

function track<T extends SqlDb>(db: T): T {
  open.push(db);
  return db;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lunetube-db-open-'));
  dir = join(root, 'library');
  file = join(dir, 'lunetube.db');
  logs.length = 0;
});
afterEach(() => {
  // Close before removing the dir (Windows EBUSY).
  for (const db of open.splice(0)) closeLibraryDb(db);
  rmSync(root, { recursive: true, force: true });
});

function openLib(migrations: readonly Migration[] = MIGRATIONS, extra = {}): OpenLibraryDbResult {
  const r = openLibraryDb({ dir, migrations, now: () => T0, log: (m) => logs.push(m), ...extra });
  if (r.status === 'ok') track(r.db);
  return r;
}

function okDb(r: OpenLibraryDbResult): SqlDb {
  if (r.status !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.db;
}

const mode = (p: string): number => statSync(p).mode & 0o777;
const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
const backups = (): string[] => readdirSync(dir).filter((n) => n.startsWith('lunetube.db.bak-'));

/** Reads a closed library file without writing to it. */
function peek<T>(path: string, fn: (db: SqlDb) => T): T {
  const db = openSqlite(path, { readonly: true, fileMustExist: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** A v1 library with one video + history row, closed. */
function seedV1(): void {
  const db = okDb(openLib());
  db.prepare("INSERT INTO videos (id, title, updated_at) VALUES ('dQw4w9WgXcQ', 'Never', 1)").run();
  db.prepare("INSERT INTO history (video_id, watched_at) VALUES ('dQw4w9WgXcQ', 2)").run();
  closeLibraryDb(db);
}

const v2 = (sql: string): readonly Migration[] => [
  ...MIGRATIONS,
  { version: 2, name: 'test', sql },
];

describe('openLibraryDb — fresh library', () => {
  it('creates v1 with the Watch Later row; dir 0700, file/-wal/-shm 0600', () => {
    const r = openLib();
    const db = okDb(r);
    expect(r.status === 'ok' && r.schemaVersion).toBe(1);
    expect(readUserVersion(db)).toBe(1);
    expect(db.prepare("SELECT id, kind FROM playlists WHERE id = 'watch-later'").get()).toEqual({
      id: 'watch-later',
      kind: 'watch_later',
    });
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    expect(db.prepare('PRAGMA secure_delete').get()).toEqual({ secure_delete: 1 });
    expect(db.prepare('PRAGMA synchronous').get()).toEqual({ synchronous: 1 });
    expect(existsSync(`${file}-wal`)).toBe(true);
    expect(backups()).toEqual([]);
    if (!isWin) {
      expect(mode(dir)).toBe(0o700);
      expect(mode(file)).toBe(0o600);
      expect(mode(`${file}-wal`)).toBe(0o600);
      expect(mode(`${file}-shm`)).toBe(0o600);
    }
  });

  it.skipIf(isWin)('tightens a pre-existing 0755 dir and 0644 file', () => {
    seedV1();
    chmodSync(dir, 0o755);
    chmodSync(file, 0o644);
    okDb(openLib());
    expect(mode(dir)).toBe(0o700);
    expect(mode(file)).toBe(0o600);
  });

  it('reopens a current library as-is (no backup) and keeps its rows', () => {
    seedV1();
    const db = okDb(openLib());
    expect(db.prepare('SELECT count(*) AS n FROM history').get()).toEqual({ n: 1 });
    expect(backups()).toEqual([]);
  });

  it('closeLibraryDb is idempotent and a clean close removes the WAL', () => {
    const db = okDb(openLib());
    closeLibraryDb(db);
    closeLibraryDb(db);
    closeLibraryDb(null);
    expect(db.open).toBe(false);
    expect(existsSync(`${file}-wal`)).toBe(false);
  });

  it('adopts an empty file left by an earlier failed attempt as v0', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, '');
    expect(readUserVersion(okDb(openLib()))).toBe(1);
  });
});

describe('openLibraryDb — upgrade', () => {
  it('v1 → v2: backs up first (0600, v1, pre-migration rows), then migrates', () => {
    seedV1();
    const r = openLib(v2('CREATE TABLE extra (x INTEGER) STRICT'));
    const db = okDb(r);
    expect(r.status === 'ok' && r.schemaVersion).toBe(2);
    expect(readUserVersion(db)).toBe(2);
    expect(db.prepare('SELECT count(*) AS n FROM history').get()).toEqual({ n: 1 });
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });

    expect(backups()).toEqual(['lunetube.db.bak-v1-20260923T030405Z']);
    const bak = join(dir, 'lunetube.db.bak-v1-20260923T030405Z');
    if (!isWin) expect(mode(bak)).toBe(0o600);
    peek(bak, (b) => {
      expect(readUserVersion(b)).toBe(1);
      expect(b.prepare('SELECT title FROM videos').all()).toEqual([{ title: 'Never' }]);
      expect(
        b.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name = 'extra'").get(),
      ).toEqual({ n: 0 });
    });
  });

  it('a failing v2 (bad SQL) → migration-failed; live DB still v1 with rows; backup retained', () => {
    seedV1();
    const r = openLib(v2('CREATE TABLE extra (x INTEGER'));
    expect(r.status).toBe('unavailable');
    if (r.status !== 'unavailable') return;
    expect(r.reason).toBe('migration-failed');
    expect(r.detail).toBe('v2:SQLITE_ERROR');
    expect(r.schemaVersion).toBe(1);
    const bak = join(dir, 'lunetube.db.bak-v1-20260923T030405Z');
    expect(r.message).toContain(bak);
    expect(r.message).not.toMatch(/syntax|CREATE/i); // no SQL text in the user-facing message
    expect(existsSync(bak)).toBe(true);

    peek(file, (d) => {
      expect(readUserVersion(d)).toBe(1);
      expect(d.prepare('SELECT count(*) AS n FROM history').get()).toEqual({ n: 1 });
      expect(
        d.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name = 'extra'").get(),
      ).toEqual({ n: 0 });
    });
    // The failed attempt left the file openable by the current app.
    expect(readUserVersion(okDb(openLib()))).toBe(1);
  });

  it('a v2 that leaves an FK violation is rolled back via foreign_key_check', () => {
    seedV1();
    const r = openLib(
      v2(
        "CREATE TABLE extra (x INTEGER); INSERT INTO history (video_id, watched_at) VALUES ('zzzzzzzzzzz', 1)",
      ),
    );
    expect(r.status === 'unavailable' && [r.reason, r.detail]).toEqual([
      'migration-failed',
      'v2:SQLITE_CONSTRAINT_FOREIGNKEY',
    ]);
    peek(file, (d) => {
      expect(readUserVersion(d)).toBe(1);
      expect(d.prepare('SELECT video_id FROM history').all()).toEqual([
        { video_id: 'dQw4w9WgXcQ' },
      ]);
    });
  });

  it('backup failure (injected) → migration-failed/backup and no migration', () => {
    seedV1();
    const r = openLib(v2('CREATE TABLE extra (x INTEGER)'), {
      backup: () => {
        throw new Error('ENOSPC');
      },
    });
    expect(r.status === 'unavailable' && [r.reason, r.detail]).toEqual([
      'migration-failed',
      'backup',
    ]);
    peek(file, (d) => {
      expect(readUserVersion(d)).toBe(1);
      expect(
        d.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name = 'extra'").get(),
      ).toEqual({ n: 0 });
    });
  });

  /** Asserts the damaged v1 file was refused before any backup or migration. */
  function expectRefusedAsCorrupt(detail: string): void {
    const r = openLib(v2('CREATE TABLE extra (x INTEGER)'));
    expect(r.status === 'unavailable' && [r.reason, r.detail, r.schemaVersion]).toEqual([
      'corrupt',
      detail,
      1,
    ]);
    expect(backups()).toEqual([]);
    peek(file, (d) => {
      expect(readUserVersion(d)).toBe(1);
      expect(
        d.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name = 'extra'").get(),
      ).toEqual({ n: 0 });
    });
  }

  it('a damaged v1 that quick_check reports (bad freelist count) → corrupt: no backup, no migration', () => {
    seedV1();
    const bytes = readFileSync(file);
    bytes.writeUInt32BE(7, 36); // header: total freelist pages (really 0)
    writeFileSync(file, bytes);
    expectRefusedAsCorrupt('quick_check');
  });

  it('a damaged v1 that quick_check throws on (bad page type) → corrupt: no backup, no migration', () => {
    seedV1();
    // Grow a table past one page, then clobber its root page's type byte.
    const db = openSqlite(file);
    db.exec('CREATE TABLE filler (x TEXT)');
    const ins = db.prepare('INSERT INTO filler VALUES (?)');
    for (let i = 0; i < 200; i++) ins.run('x'.repeat(200));
    const { rootpage: rootPage } = db
      .prepare("SELECT rootpage FROM sqlite_schema WHERE name = 'filler'")
      .get() as { rootpage: number };
    const { page_size: pageSize } = db.prepare('PRAGMA page_size').get() as { page_size: number };
    db.close(); // checkpoints the WAL into the main file
    const bytes = readFileSync(file);
    bytes[(rootPage - 1) * pageSize] = 0x00; // not a valid b-tree page type
    writeFileSync(file, bytes);
    expectRefusedAsCorrupt('sqlite:SQLITE_CORRUPT');
  });
});

describe('openLibraryDb — refusals leave the file untouched', () => {
  function writeForeignDb(setup: string): void {
    mkdirSync(dir, { recursive: true });
    const db = openSqlite(file); // rollback-journal mode: WAL would rewrite header bytes 18-19
    db.exec(setup);
    db.close();
  }

  it('user_version 99 → schema-newer; main file byte-identical; nothing created', () => {
    writeForeignDb('CREATE TABLE future (x INTEGER); PRAGMA user_version = 99');
    const before = sha(file);
    const r = openLib();
    expect(r.status === 'unavailable' && [r.reason, r.schemaVersion]).toEqual(['schema-newer', 99]);
    expect(r.status === 'unavailable' && r.message).toMatch(/v99.*v1.*Update LuneTube/);
    expect(sha(file)).toBe(before);
    expect(readdirSync(dir)).toEqual(['lunetube.db']); // no -wal/-shm/backup
  });

  it('user_version 99 held only in a leftover WAL (crash) → schema-newer; main + WAL untouched', () => {
    mkdirSync(dir, { recursive: true });
    // A separate process writes v1 to the main file, then v99 into the WAL, and dies without
    // closing (SIGKILL: no checkpoint). Uses node:sqlite so the test does not depend on the driver.
    const script = `
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(${JSON.stringify(file)});
      db.exec('CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1); PRAGMA user_version = 1');
      db.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0');
      db.exec('INSERT INTO t VALUES (2); PRAGMA user_version = 99');
      process.kill(process.pid, 'SIGKILL');
    `;
    const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    expect(child.stderr).not.toMatch(/Error/);
    // Preconditions: a crash-state WAL exists and the main file alone still says v1.
    expect(statSync(`${file}-wal`).size).toBeGreaterThan(0);
    const mainBytes = readFileSync(file);
    expect(mainBytes.readUInt32BE(60)).toBe(1); // header user_version

    const before = { main: sha(file), wal: sha(`${file}-wal`) };
    const r = openLib();
    expect(r.status === 'unavailable' && [r.reason, r.schemaVersion]).toEqual(['schema-newer', 99]);
    expect(sha(file)).toBe(before.main);
    expect(existsSync(`${file}-wal`)).toBe(true);
    expect(sha(`${file}-wal`)).toBe(before.wal);
    expect(backups()).toEqual([]);
  });

  it('a garbage file → corrupt, bytes unchanged', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, 'this is not a database\n'.repeat(400));
    const before = sha(file);
    const r = openLib();
    expect(r.status === 'unavailable' && [r.reason, r.detail]).toEqual([
      'corrupt',
      'sqlite:SQLITE_NOTADB',
    ]);
    expect(sha(file)).toBe(before);
    expect(readdirSync(dir)).toEqual(['lunetube.db']);
  });

  it('v0 with a foreign table → corrupt ("not a LuneTube library"), bytes unchanged', () => {
    writeForeignDb('CREATE TABLE someone_elses (x INTEGER)');
    const before = sha(file);
    const r = openLib();
    expect(r.status === 'unavailable' && [r.reason, r.detail, r.schemaVersion]).toEqual([
      'corrupt',
      'foreign-schema',
      0,
    ]);
    expect(sha(file)).toBe(before);
  });

  it('a directory where the file should be → open-failed', () => {
    mkdirSync(file, { recursive: true });
    const r = openLib();
    expect(r.status === 'unavailable' && r.reason).toBe('open-failed');
  });

  it('never throws, even for an unusable directory path', () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(dir, 'a file, not a directory');
    const r = openLib();
    expect(r.status === 'unavailable' && r.reason).toBe('open-failed');
    expect(logs.some((l) => l.includes('open-failed'))).toBe(true);
  });
});
