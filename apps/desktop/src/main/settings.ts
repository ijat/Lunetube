import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { app } from 'electron';
import { DEFAULT_SETTINGS, type Settings } from '@lunetube/shared';

/**
 * Phase-0 persistence: a JSON file in `userData`. SQLite takes over the settings
 * table in Phase 3 (schema in plan Architecture); the shape is already the
 * shared `Settings` DTO so nothing downstream changes.
 */
const settingsPath = () => join(app.getPath('userData'), 'settings.json');

function coerce(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS };
  const merged = { ...DEFAULT_SETTINGS, ...(raw as Partial<Settings>) };
  // Clamp the couple of numeric fields that must stay in range.
  merged.glassLevel = Math.min(1, Math.max(0, merged.glassLevel));
  merged.defaultSpeed = Math.min(4, Math.max(0.25, merged.defaultSpeed));
  merged.thumbnailCacheMb = Math.max(64, Math.round(merged.thumbnailCacheMb));
  return merged;
}

let cache: Settings | null = null;

export function getSettings(): Settings {
  if (cache) return cache;
  try {
    cache = coerce(JSON.parse(readFileSync(settingsPath(), 'utf8')));
  } catch {
    cache = { ...DEFAULT_SETTINGS };
  }
  return cache;
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next = coerce({ ...getSettings(), ...patch });
  cache = next;
  const p = settingsPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(next, null, 2));
  return next;
}
