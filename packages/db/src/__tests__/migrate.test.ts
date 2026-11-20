import { afterEach, describe, expect, it } from 'vitest';
import { openSqlite, sqliteErrorCode, tx, type SqlDb } from '../driver.js';
import {
  applyMigrations,
  assertContiguous,
  MigrationError,
  readUserVersion,
  targetVersion,
  type Migration,
} from '../migrate.js';
import { MIGRATIONS, SCHEMA_VERSION } from '../migrations/index.js';

const m = (version: number, sql: string): Migration => ({ version, name: `m${version}`, sql });

let db: SqlDb | null = null;
function mem(): SqlDb {
  db = openSqlite(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}
afterEach(() => {
  if (db?.open) db.close();
  db = null;
});

function tables(d: SqlDb): string[] {
  return (
    d.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((r) => r.name);
}

function foreignKeysOn(d: SqlDb): boolean {
  return (d.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys === 1;
}

describe('MIGRATIONS', () => {
  it('is numbered exactly 1..N and SCHEMA_VERSION is N', () => {
    expect(MIGRATIONS.map((x) => x.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
    expect(SCHEMA_VERSION).toBe(MIGRATIONS.length);
    expect(SCHEMA_VERSION).toBe(1);
  });

  it('has unique names', () => {
    expect(new Set(MIGRATIONS.map((x) => x.name)).size).toBe(MIGRATIONS.length);
  });
});

describe('assertContiguous / targetVersion', () => {
  it('accepts 1..N and the empty list', () => {
    expect(() => assertContiguous([m(1, ''), m(2, ''), m(3, '')])).not.toThrow();
    expect(() => assertContiguous([])).not.toThrow();
    expect(targetVersion([])).toBe(0);
    expect(targetVersion([m(1, ''), m(2, '')])).toBe(2);
  });

  it.each([
    ['a gap', [m(1, ''), m(3, '')]],
    ['a duplicate', [m(1, ''), m(1, '')]],
    ['a list not starting at 1', [m(2, '')]],
    ['a reorder', [m(2, ''), m(1, '')]],
  ])('rejects %s', (_label, list) => {
    expect(() => assertContiguous(list)).toThrow(/1\.\.N/);
  });
});

describe('tx', () => {
  it('commits on success and returns the body result', () => {
    const d = mem();
    d.exec('CREATE TABLE t (x INTEGER)');
    expect(tx(d, () => d.prepare('INSERT INTO t VALUES (1)').run().changes)).toBe(1);
    expect(d.inTransaction).toBe(false);
    expect(d.prepare('SELECT count(*) AS n FROM t').get()).toEqual({ n: 1 });
  });

  it('rolls back everything on throw and rethrows the original error', () => {
    const d = mem();
    d.exec('CREATE TABLE t (x INTEGER)');
    const boom = new Error('boom');
    expect(() =>
      tx(d, () => {
        d.prepare('INSERT INTO t VALUES (1)').run();
        throw boom;
      }),
    ).toThrow(boom);
    expect(d.inTransaction).toBe(false);
    expect(d.prepare('SELECT count(*) AS n FROM t').get()).toEqual({ n: 0 });
  });

  it('refuses to nest, and the outer transaction rolls back', () => {
    const d = mem();
    d.exec('CREATE TABLE t (x INTEGER)');
    expect(() =>
      tx(d, () => {
        d.prepare('INSERT INTO t VALUES (1)').run();
        tx(d, () => d.prepare('INSERT INTO t VALUES (2)').run());
      }),
    ).toThrow(/already inside a transaction/);
    expect(d.inTransaction).toBe(false);
    expect(d.prepare('SELECT count(*) AS n FROM t').get()).toEqual({ n: 0 });
  });

  it('refuses a body that returns a promise (rolled back, not committed early)', () => {
    const d = mem();
    d.exec('CREATE TABLE t (x INTEGER)');
    expect(() =>
      tx(d, () => {
        d.prepare('INSERT INTO t VALUES (1)').run();
        return Promise.resolve();
      }),
    ).toThrow(/synchronous/);
    expect(d.prepare('SELECT count(*) AS n FROM t').get()).toEqual({ n: 0 });
  });
});

describe('applyMigrations', () => {
  it('applies pending migrations in order and sets user_version', () => {
    const d = mem();
    const list = [m(1, 'CREATE TABLE a (x INTEGER)'), m(2, 'CREATE TABLE b (x INTEGER)')];
    expect(applyMigrations(d, 0, list)).toBe(2);
    expect(readUserVersion(d)).toBe(2);
    expect(tables(d)).toEqual(['a', 'b']);
    expect(foreignKeysOn(d)).toBe(true);
    // Idempotent at the target.
    expect(applyMigrations(d, 2, list)).toBe(2);
  });

  it('only runs migrations above fromVersion', () => {
    const d = mem();
    applyMigrations(d, 0, [m(1, 'CREATE TABLE a (x INTEGER)')]);
    const list = [m(1, 'CREATE TABLE a (x INTEGER)'), m(2, 'CREATE TABLE b (x INTEGER)')];
    expect(applyMigrations(d, 1, list)).toBe(2);
    expect(tables(d)).toEqual(['a', 'b']);
  });

  it('runs all pending migrations in ONE transaction: a later failure undoes the earlier ones', () => {
    const d = mem();
    const list = [m(1, 'CREATE TABLE a (x INTEGER)'), m(2, 'CREATE TABLE b (x INTEGER'), m(3, '')];
    let err: unknown;
    try {
      applyMigrations(d, 0, list);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MigrationError);
    expect((err as MigrationError).version).toBe(2);
    expect((err as MigrationError).code).toBe('SQLITE_ERROR');
    expect(readUserVersion(d)).toBe(0);
    expect(tables(d)).toEqual([]);
    expect(d.inTransaction).toBe(false);
    expect(foreignKeysOn(d)).toBe(true);
  });

  it('defers FK checking to foreign_key_check and rolls back a violating migration', () => {
    const d = mem();
    applyMigrations(d, 0, [
      m(1, 'CREATE TABLE p (id TEXT PRIMARY KEY); CREATE TABLE c (pid TEXT REFERENCES p(id))'),
    ]);
    const list = [
      m(1, ''),
      // With foreign_keys OFF this insert is accepted mid-migration; the check must catch it.
      m(2, "CREATE TABLE extra (x INTEGER); INSERT INTO c VALUES ('missing')"),
    ];
    let err: unknown;
    try {
      applyMigrations(d, 1, list);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MigrationError);
    expect((err as MigrationError).code).toBe('SQLITE_CONSTRAINT_FOREIGNKEY');
    expect(readUserVersion(d)).toBe(1);
    expect(tables(d)).toEqual(['c', 'p']);
    expect(d.prepare('SELECT count(*) AS n FROM c').get()).toEqual({ n: 0 });
    expect(foreignKeysOn(d)).toBe(true);
  });

  it('allows a table rebuild that is only FK-consistent at the end (foreign_keys OFF during)', () => {
    const d = mem();
    applyMigrations(d, 0, [
      m(
        1,
        "CREATE TABLE p (id TEXT PRIMARY KEY); CREATE TABLE c (pid TEXT REFERENCES p(id)); INSERT INTO p VALUES ('a'); INSERT INTO c VALUES ('a')",
      ),
    ]);
    // SQLite's documented 12-step rebuild: with FKs enforced, DROP TABLE p would fail/cascade.
    const rebuild = m(
      2,
      'CREATE TABLE p_new (id TEXT PRIMARY KEY, extra INTEGER NOT NULL DEFAULT 0); INSERT INTO p_new(id) SELECT id FROM p; DROP TABLE p; ALTER TABLE p_new RENAME TO p',
    );
    expect(applyMigrations(d, 1, [m(1, ''), rebuild])).toBe(2);
    expect(d.prepare('SELECT count(*) AS n FROM c').get()).toEqual({ n: 1 });
    expect(d.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('rejects a non-contiguous list before touching the database', () => {
    const d = mem();
    expect(() => applyMigrations(d, 0, [m(1, 'CREATE TABLE a (x INTEGER)'), m(3, '')])).toThrow(
      /1\.\.N/,
    );
    expect(tables(d)).toEqual([]);
  });

  it('surfaces SQLite codes through sqliteErrorCode', () => {
    const d = mem();
    let code: string | null = 'unset';
    try {
      d.exec('SELEC 1');
    } catch (e) {
      code = sqliteErrorCode(e);
    }
    expect(code).toBe('SQLITE_ERROR');
    expect(sqliteErrorCode(new Error('plain'))).toBeNull();
  });
});
