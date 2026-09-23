/**
 * Forward-only migration runner (A24). The policy — probe, refuse, back up, then run — lives in
 * `open.ts`; this module is the transactional core both it and `openMemoryDb()` share.
 *
 * Ordering constraints (plan P3-F3), each load-bearing:
 * - `PRAGMA foreign_keys` is a no-op inside a transaction → toggled OFF before `BEGIN`, ON after.
 * - `PRAGMA user_version = N` inside the transaction rolls back with it → a failed run leaves the
 *   version where it was.
 * - All pending migrations share ONE transaction, and `PRAGMA foreign_key_check` must return no rows
 *   before `COMMIT` (SQLite's documented table-rebuild procedure) → never a half-upgraded schema.
 */
import { sqliteErrorCode, tx, type SqlDb } from './driver.js';

export interface Migration {
  /** Contiguous from 1. Becomes `PRAGMA user_version` once applied. */
  readonly version: number;
  readonly name: string;
  /** One or more statements. Must not contain its own BEGIN/COMMIT. */
  readonly sql: string;
}

/** Throws unless the versions are exactly 1..N in order (N may be 0). */
export function assertContiguous(migrations: readonly Migration[]): void {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(
        `migrations must be numbered 1..N in order: index ${i} has version ${m.version} (expected ${i + 1})`,
      );
    }
  });
}

/** The schema version a migration list produces (0 for an empty list). */
export function targetVersion(migrations: readonly Migration[]): number {
  return migrations.at(-1)?.version ?? 0;
}

/** `PRAGMA user_version` — reads through the WAL, writes nothing. */
export function readUserVersion(db: SqlDb): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  return row?.user_version ?? 0;
}

/** Why a migration run failed: the version being applied (or reached) and the SQLite code, if any. */
export class MigrationError extends Error {
  readonly version: number;
  readonly code: string | null;

  constructor(version: number, code: string | null, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MigrationError';
    this.version = version;
    this.code = code;
  }
}

/**
 * Applies every migration with `version > fromVersion`, in order, in one `BEGIN IMMEDIATE`
 * transaction. On any failure everything rolls back (schema and `user_version`) and a
 * `MigrationError` is thrown. `foreign_keys` is ON again when this returns or throws.
 *
 * Does NOT back up, quick_check or set the other connection pragmas — `open.ts` owns that policy.
 */
export function applyMigrations(
  db: SqlDb,
  fromVersion: number,
  migrations: readonly Migration[],
): number {
  assertContiguous(migrations);
  const pending = migrations.filter((m) => m.version > fromVersion);
  if (pending.length === 0) return fromVersion;

  let current = pending[0]?.version ?? fromVersion;
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    tx(db, () => {
      for (const m of pending) {
        current = m.version;
        db.exec(m.sql);
        if (!db.inTransaction) {
          throw new Error(`migration ${m.version} (${m.name}) ended the transaction`);
        }
        // The only interpolation into SQL in this package — our own integer constant, checked.
        if (!Number.isSafeInteger(m.version) || m.version < 1) {
          throw new Error(`migration version ${String(m.version)} is not a positive integer`);
        }
        db.exec(`PRAGMA user_version = ${m.version}`);
      }
      const violations = db.prepare('PRAGMA foreign_key_check').all();
      if (violations.length > 0) {
        throw new MigrationError(
          current,
          'SQLITE_CONSTRAINT_FOREIGNKEY',
          `migration to v${current} left ${violations.length} foreign-key violation(s)`,
        );
      }
    });
  } catch (e) {
    if (e instanceof MigrationError) throw e;
    const code = sqliteErrorCode(e);
    throw new MigrationError(
      current,
      code,
      `migration v${current} failed${code ? ` (${code})` : ''}: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  return current;
}
