import { assertContiguous, targetVersion, type Migration } from '../migrate.js';
import { m0001_init } from './0001_init.js';

/** Every migration, in order. Append only — never edit or reorder a shipped entry (A24). */
export const MIGRATIONS: readonly Migration[] = [m0001_init];

// Module-load guard: a gap, duplicate or reorder fails at import, not on a user's library.
assertContiguous(MIGRATIONS);

/** The schema version this build of the app writes. */
export const SCHEMA_VERSION: number = targetVersion(MIGRATIONS);
