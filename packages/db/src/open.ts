/**
 * `openLibraryDb` — decides, for a file that may hold a user's history, whether to open it as-is,
 * back it up and migrate it, or refuse. Never throws; never deletes, recreates or "repairs" a file.
 *
 * Invariants (A24, plan P3-2):
 * I1 A library newer than this app is refused before ANY write — not a pragma, not a WAL checkpoint.
 *    Hence the read-only probe (a read-write close checkpoints a leftover WAL; `journal_mode=WAL`
 *    rewrites header bytes on a rollback-journal file — plan P3-F3 #9/#10).
 * I2 A file that is not a LuneTube library, or is damaged, is never migrated (`corrupt`).
 * I3 An existing library (v > 0) is never migrated without a `VACUUM INTO` backup first.
 * I4 Migrations are all-or-nothing (`applyMigrations`): on failure the file is left at its old
 *    `user_version` with its rows intact, and the library is unavailable for this session.
 * I5 The library directory is 0700 and the file (hence `-wal`/`-shm`) 0600, best-effort.
 */
import { chmodSync, closeSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import type { DbUnavailableReason } from '@lunetube/shared';
import { backupDb, DB_FILE_NAME } from './backup.js';
import { openSqlite, sqliteErrorCode, type SqlDb } from './driver.js';
import { MIGRATIONS } from './migrations/index.js';
import {
  applyMigrations,
  assertContiguous,
  MigrationError,
  readUserVersion,
  targetVersion,
  type Migration,
} from './migrate.js';

export interface OpenLibraryDbOptions {
  /** The library directory, e.g. `<userData>/library`. Created if absent. */
  dir: string;
  migrations?: readonly Migration[];
  /** Epoch ms; names the pre-migration backup. */
  now?: () => number;
  /** Diagnostics sink (full error text goes here, never into `message`). */
  log?: (message: string) => void;
  /** Test seam: the pre-migration snapshot. Defaults to `backupDb`. */
  backup?: typeof backupDb;
}

export type OpenLibraryDbResult =
  | { status: 'ok'; db: SqlDb; schemaVersion: number; file: string }
  | {
      status: 'unavailable';
      reason: DbUnavailableReason;
      /** User-facing; contains no SQL or SQLite error text. */
      message: string;
      /** Machine-readable cause, e.g. `sqlite:SQLITE_NOTADB`, `backup`, `v2:SQLITE_ERROR`. */
      detail: string;
      /** The file's `user_version` when it could be read, else `null`. */
      schemaVersion: number | null;
      file: string;
    };

type Unavailable = Extract<OpenLibraryDbResult, { status: 'unavailable' }>;

function describe(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

function isCorruptCode(code: string | null): boolean {
  return code !== null && (code.startsWith('SQLITE_NOTADB') || code.startsWith('SQLITE_CORRUPT'));
}

function errDetail(e: unknown): string {
  const code = sqliteErrorCode(e);
  if (code) return `sqlite:${code}`;
  const errno = (e as NodeJS.ErrnoException | null)?.code;
  return typeof errno === 'string' ? `fs:${errno}` : 'error';
}

/** `{ v, hasSchema }` from a connection — reads only (through the WAL, if any). Throws driver errors. */
function inspect(db: SqlDb): { v: number; hasSchema: boolean } {
  const v = readUserVersion(db);
  const row = db.prepare('SELECT count(*) AS n FROM sqlite_schema').get() as { n: number };
  return { v, hasSchema: row.n > 0 };
}

function closeQuietly(db: SqlDb | null): void {
  try {
    if (db?.open) db.close();
  } catch {
    // Nothing useful to do; the handle is abandoned either way.
  }
}

/** Idempotent. A clean close checkpoints the WAL into the main file and removes `-wal`/`-shm`. */
export function closeLibraryDb(db: SqlDb | null | undefined): void {
  if (db?.open) db.close();
}

export function openLibraryDb(options: OpenLibraryDbOptions): OpenLibraryDbResult {
  const {
    dir,
    migrations = MIGRATIONS,
    now = Date.now,
    log = () => {},
    backup = backupDb,
  } = options;
  const file = join(dir, DB_FILE_NAME);

  const fail = (
    reason: DbUnavailableReason,
    message: string,
    detail: string,
    schemaVersion: number | null,
    cause?: unknown,
  ): Unavailable => {
    log(
      `[db] library unavailable (${reason}, ${detail})${cause === undefined ? '' : `: ${describe(cause)}`}`,
    );
    return { status: 'unavailable', reason, message, detail, schemaVersion, file };
  };

  let target: number;
  try {
    assertContiguous(migrations);
    target = targetVersion(migrations);
  } catch (e) {
    return fail(
      'migration-failed',
      'This build of LuneTube is misconfigured.',
      'migrations',
      null,
      e,
    );
  }

  // 1. Directory: create 0700; tighten a pre-existing one (ledger `cache-dir-world-readable`).
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch (e) {
    return fail('open-failed', 'The library folder could not be created.', errDetail(e), null, e);
  }
  try {
    chmodSync(dir, 0o700);
  } catch (e) {
    log(`[db] could not restrict ${dir} to 0700 (continuing): ${describe(e)}`);
  }

  // 2. File: create it 0600 ourselves so SQLite's -wal/-shm inherit 0600 (P3-F3 #4).
  let created = false;
  try {
    closeSync(openSync(file, 'wx', 0o600));
    created = true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') {
      return fail('open-failed', 'The library file could not be created.', errDetail(e), null, e);
    }
    try {
      chmodSync(file, 0o600);
    } catch (chmodErr) {
      log(`[db] could not restrict ${file} to 0600 (continuing): ${describe(chmodErr)}`);
    }
  }

  // 3. Read-only probe of an existing file (I1). A new file is v0 by construction.
  let probed: { v: number; hasSchema: boolean } | null = created
    ? { v: 0, hasSchema: false }
    : null;
  if (!created) {
    let probe: SqlDb;
    try {
      probe = openSqlite(file, { readonly: true, fileMustExist: true });
    } catch (e) {
      return fail('open-failed', 'The library file could not be opened.', errDetail(e), null, e);
    }
    try {
      probed = inspect(probe);
    } catch (e) {
      const code = sqliteErrorCode(e);
      if (isCorruptCode(code)) {
        return fail(
          'corrupt',
          'The library file is damaged or is not a LuneTube library.',
          errDetail(e),
          null,
          e,
        );
      }
      // e.g. SQLITE_READONLY_ROLLBACK (hot journal on a non-WAL filesystem): only a read-write
      // connection can run SQLite's (schema-agnostic) crash recovery. Re-checked in step 5.
      log(`[db] read-only probe inconclusive, retrying read-write: ${describe(e)}`);
    } finally {
      closeQuietly(probe);
    }
  }

  const refuse = (state: { v: number; hasSchema: boolean }): Unavailable | null => {
    if (!Number.isSafeInteger(state.v) || state.v < 0 || (state.v === 0 && state.hasSchema)) {
      return fail('corrupt', 'This file is not a LuneTube library.', 'foreign-schema', state.v);
    }
    if (state.v > target) {
      return fail(
        'schema-newer',
        `This library was written by a newer LuneTube (schema v${state.v}; this version supports v${target}). Update LuneTube to open it.`,
        `schema:${state.v}>${target}`,
        state.v,
      );
    }
    return null;
  };

  // 4. Newer than us / not ours → refuse; nothing has been written.
  if (probed) {
    const refusal = refuse(probed);
    if (refusal) return refusal;
  }

  // 5. Read-write connection.
  let db: SqlDb;
  try {
    db = openSqlite(file);
  } catch (e) {
    return fail(
      'open-failed',
      'The library file could not be opened.',
      errDetail(e),
      probed?.v ?? null,
      e,
    );
  }

  let v: number;
  try {
    // Authoritative re-read before any pragma (and the whole check when the probe fell through).
    const state = inspect(db);
    const refusal = refuse(state);
    if (refusal) {
      closeQuietly(db);
      return refusal;
    }
    v = state.v;
  } catch (e) {
    closeQuietly(db);
    const code = sqliteErrorCode(e);
    return isCorruptCode(code)
      ? fail(
          'corrupt',
          'The library file is damaged or is not a LuneTube library.',
          errDetail(e),
          null,
          e,
        )
      : fail(
          'open-failed',
          'The library file could not be read.',
          errDetail(e),
          probed?.v ?? null,
          e,
        );
  }

  // 6. Connection pragmas.
  try {
    const mode = (
      db.prepare('PRAGMA journal_mode = WAL').get() as { journal_mode?: string } | undefined
    )?.journal_mode;
    if (mode !== 'wal') {
      log(`[db] WAL unavailable on this filesystem; journal_mode=${String(mode)}`);
    }
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA secure_delete = ON');
  } catch (e) {
    closeQuietly(db);
    const code = sqliteErrorCode(e);
    return isCorruptCode(code)
      ? fail('corrupt', 'The library file is damaged.', errDetail(e), v, e)
      : fail(
          'open-failed',
          'The library file could not be opened for writing.',
          errDetail(e),
          v,
          e,
        );
  }

  if (v === target) return { status: 'ok', db, schemaVersion: v, file };

  // 7. Upgrade an existing library: integrity, then backup (I2, I3).
  let backupPath: string | null = null;
  if (v > 0) {
    try {
      const rows = db.prepare('PRAGMA quick_check').all() as { quick_check?: unknown }[];
      const ok = rows.length === 1 && rows[0]?.quick_check === 'ok';
      if (!ok) {
        closeQuietly(db);
        return fail(
          'corrupt',
          'The library file is damaged, so it was not upgraded.',
          'quick_check',
          v,
          new Error(rows.map((r) => String(r.quick_check)).join('; ')),
        );
      }
    } catch (e) {
      closeQuietly(db);
      return fail(
        'corrupt',
        'The library file is damaged, so it was not upgraded.',
        errDetail(e),
        v,
        e,
      );
    }
    try {
      backupPath = backup(db, dir, `v${v}`, now());
    } catch (e) {
      closeQuietly(db);
      return fail(
        'migration-failed',
        'The library could not be backed up before upgrading, so it was not upgraded.',
        'backup',
        v,
        e,
      );
    }
  }

  // 7(c) / 8. All pending migrations, one transaction (I4).
  try {
    const reached = applyMigrations(db, v, migrations);
    return { status: 'ok', db, schemaVersion: reached, file };
  } catch (e) {
    closeQuietly(db);
    const failedAt = e instanceof MigrationError ? e.version : v + 1;
    const code = e instanceof MigrationError ? e.code : sqliteErrorCode(e);
    return fail(
      'migration-failed',
      backupPath
        ? `The library could not be upgraded to v${failedAt}; it was left at v${v}. A backup is at ${backupPath}.`
        : `The library could not be set up (schema v${failedAt}).`,
      `v${failedAt}:${code ?? 'error'}`,
      v,
      e,
    );
  }
}
