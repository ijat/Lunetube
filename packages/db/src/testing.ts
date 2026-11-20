/**
 * Test-only helpers (`@lunetube/db/testing`). Never imported by production code.
 */
import { openSqlite, type SqlDb } from './driver.js';
import { applyMigrations, type Migration } from './migrate.js';
import { MIGRATIONS } from './migrations/index.js';

/**
 * A fresh `:memory:` library at the latest schema (or `migrations`' last version), with the same
 * connection pragmas the app sets that matter in memory (`foreign_keys`, `secure_delete`).
 * Applies migrations through the production runner, so the schema is exactly what users get.
 */
export function openMemoryDb(migrations: readonly Migration[] = MIGRATIONS): SqlDb {
  const db = openSqlite(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA secure_delete = ON');
  applyMigrations(db, 0, migrations);
  return db;
}
