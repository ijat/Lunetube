/**
 * Library snapshots (A24 migrations, A31 imports) and their removal (A27 "Clear history").
 *
 * `VACUUM INTO ?` is used rather than copying the file because it snapshots the database as the
 * connection sees it — committed WAL frames included — where a raw copy of the main file can miss
 * committed-but-uncheckpointed data after a crash (plan P3-F3 #3). It cannot run inside a
 * transaction and fails if the target already exists.
 */
import { chmodSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { SqlDb } from './driver.js';

/** The live library file's name inside the library directory. */
export const DB_FILE_NAME = 'lunetube.db';

const BACKUP_PREFIX = `${DB_FILE_NAME}.bak-`;
/** `lunetube.db.bak-<kind>-<yyyymmddTHHMMSSZ>[-<n>]` */
const BACKUP_NAME = /^lunetube\.db\.bak-([a-z0-9]+)-(\d{8}T\d{6}Z)(?:-(\d+))?$/;
const KIND = /^[a-z0-9]+$/;
/** Migration backups (`v1`, `v2`, …) are pruned together as one kind; `import` is another. */
const MIGRATION_KIND = /^v\d+$/;
const KEEP_PER_KIND = 2;
const MAX_COLLISION_SUFFIX = 1000;

/** UTC `yyyymmddTHHMMSSZ`. */
function stamp(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z';
}

function pruneGroup(kind: string): string {
  return MIGRATION_KIND.test(kind) ? 'v*' : kind;
}

interface ParsedBackup {
  name: string;
  group: string;
  stamp: string;
  suffix: number;
}

function parseBackupName(name: string): ParsedBackup | null {
  const m = BACKUP_NAME.exec(name);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  return { name, group: pruneGroup(m[1]), stamp: m[2], suffix: m[3] ? Number(m[3]) : 1 };
}

/**
 * Snapshots `db` to `<dir>/lunetube.db.bak-<kind>-<UTC stamp>` (`-2`, `-3`, … on a name collision),
 * restricts it to `0600`, then prunes that kind to the newest two. Returns the backup's path.
 * Throws if the snapshot cannot be written (callers must then NOT proceed with the risky write).
 *
 * `kind` is `v<N>` (pre-migration, N = the version being backed up) or `import`.
 */
export function backupDb(db: SqlDb, dir: string, kind: string, now: number = Date.now()): string {
  if (!KIND.test(kind)) throw new Error(`backupDb: invalid kind ${JSON.stringify(kind)}`);
  const base = `${BACKUP_PREFIX}${kind}-${stamp(now)}`;

  let target: string | null = null;
  for (let n = 1; n <= MAX_COLLISION_SUFFIX; n++) {
    const candidate = join(dir, n === 1 ? base : `${base}-${n}`);
    if (!existsSync(candidate)) {
      target = candidate;
      break;
    }
  }
  if (target === null) throw new Error(`backupDb: no free backup name for ${base}`);

  try {
    // Bound, never interpolated. Fails (rather than overwrites) if the target appeared meanwhile.
    db.prepare('VACUUM INTO ?').run(target);
  } catch (e) {
    // A partial snapshot (e.g. ENOSPC) must not survive to be counted as one of the newest two.
    // The name was free a moment ago, so a file there is ours — unless SQLite refused because
    // something else created it in between, in which case it is not ours to delete.
    if (!(e instanceof Error && /already exists/i.test(e.message))) {
      rmSync(target, { force: true });
    }
    throw e;
  }

  // VACUUM INTO creates the file with the process umask (0644). Best-effort like the live file:
  // a filesystem without POSIX modes (FAT/exFAT/SMB) must not block a migration forever, and the
  // library directory itself is 0700 wherever modes exist. A no-op beyond read-only on Windows.
  try {
    chmodSync(target, 0o600);
  } catch {
    // see above
  }

  pruneBackups(dir, pruneGroup(kind));
  return target;
}

/** Deletes all but the newest `KEEP_PER_KIND` backups of one prune group. Best-effort. */
function pruneBackups(dir: string, group: string): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  const backups = names
    .map(parseBackupName)
    .filter((b): b is ParsedBackup => b !== null && b.group === group)
    .sort((a, b) => (a.stamp === b.stamp ? b.suffix - a.suffix : a.stamp < b.stamp ? 1 : -1));
  for (const old of backups.slice(KEEP_PER_KIND)) {
    try {
      rmSync(join(dir, old.name), { force: true });
    } catch {
      // Leave it; the next backup's prune retries.
    }
  }
}

/**
 * Removes every `lunetube.db.bak-*` in `dir` (A27: clearing history must not leave a copy behind).
 * Attempts all of them; throws after the sweep if any could not be removed. Returns the count removed.
 */
export function deleteBackups(dir: string): number {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw e;
  }
  let removed = 0;
  let firstError: unknown = null;
  for (const name of names) {
    if (!name.startsWith(BACKUP_PREFIX)) continue;
    try {
      rmSync(join(dir, name), { force: true });
      removed++;
    } catch (e) {
      firstError ??= e;
    }
  }
  if (firstError !== null) throw firstError;
  return removed;
}
