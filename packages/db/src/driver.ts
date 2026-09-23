/**
 * The SQLite driver seam — the ONLY file in the repo that imports a driver (A22).
 *
 * Everything else in `packages/db` (and every consumer) is typed against the
 * structural `SqlDb` / `SqlStatement` below, so swapping `better-sqlite3` for
 * `node:sqlite` (the verified fallback, plan P3-F2) is a change to this file alone.
 * Keep the surface to what both drivers support identically: positional `?`
 * parameters, `prepare → run/get/all`, `exec`, `close`.
 */
import Database from 'better-sqlite3';

/** A value SQLite can bind or return. Booleans are deliberately absent (both drivers reject them). */
export type SqlValue = null | number | bigint | string | Uint8Array;

export interface SqlRunResult {
  changes: number;
}

export interface SqlStatement {
  run(...params: SqlValue[]): SqlRunResult;
  /** First row, or `undefined` when there is none. Rows are plain objects keyed by column name. */
  get(...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
}

export interface SqlDb {
  prepare(sql: string): SqlStatement;
  /** Runs one or more statements; results are discarded. */
  exec(sql: string): void;
  close(): void;
  readonly open: boolean;
  readonly inTransaction: boolean;
}

export interface OpenSqliteOptions {
  readonly?: boolean;
  fileMustExist?: boolean;
}

/** Busy timeout (ms). better-sqlite3's own default, stated so it survives a driver swap. */
const BUSY_TIMEOUT_MS = 5000;

/** Opens a connection. Throws on failure (callers classify with `sqliteErrorCode`). */
export function openSqlite(file: string, options: OpenSqliteOptions = {}): SqlDb {
  return new Database(file, {
    readonly: options.readonly ?? false,
    fileMustExist: options.fileMustExist ?? false,
    timeout: BUSY_TIMEOUT_MS,
  });
}

/**
 * The SQLite result-code name (`'SQLITE_NOTADB'`, `'SQLITE_CORRUPT'`, `'SQLITE_CONSTRAINT_FOREIGNKEY'`, …)
 * when `e` is a driver error, else `null` (e.g. a JS `TypeError` or an fs error).
 */
export function sqliteErrorCode(e: unknown): string | null {
  return e instanceof Database.SqliteError ? e.code : null;
}

/**
 * Runs `fn` inside `BEGIN IMMEDIATE` … `COMMIT`; `ROLLBACK` if `fn` (or `COMMIT`) throws, then rethrows.
 *
 * Refuses to nest: repositories never open transactions, services do — so a nested call is a bug,
 * not a savepoint. `fn` must be synchronous (a returned promise would commit before it settles).
 */
export function tx<T>(db: SqlDb, fn: () => T): T {
  if (db.inTransaction) {
    throw new Error('tx(): already inside a transaction (nesting is not supported)');
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    if (result instanceof Promise) {
      throw new Error('tx(): the transaction body must be synchronous');
    }
    db.exec('COMMIT');
    return result;
  } catch (e) {
    if (db.inTransaction) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // The original error is the one worth reporting; SQLite has already
        // rolled back if ROLLBACK itself fails (e.g. the transaction was auto-aborted).
      }
    }
    throw e;
  }
}
