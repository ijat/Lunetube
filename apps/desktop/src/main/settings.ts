import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { app } from 'electron';
import {
  ACCENT_THEMES,
  DEFAULT_SETTINGS,
  GLASS_LEVEL_MAX,
  GLASS_LEVEL_MIN,
  MOTION_PREFERENCES,
  QUALITY_PREFERENCES,
  SPEED_MAX,
  SPEED_MIN,
  THUMBNAIL_CACHE_MB_MIN,
  type Settings,
} from '@lunetube/shared';

/**
 * Phase-0 persistence: a JSON file in `userData`. SQLite takes over the settings
 * table in Phase 3 (schema in plan Architecture); the shape is already the
 * shared `Settings` DTO so nothing downstream changes.
 */
const settingsPath = () => join(app.getPath('userData'), 'settings.json');

type Validator<K extends keyof Settings> = (value: unknown) => Settings[K];

function inEnum<T extends string>(list: readonly T[]): (value: unknown) => T {
  return (value: unknown): T => {
    if (typeof value === 'string' && (list as readonly string[]).includes(value)) return value as T;
    throw new Error('value not a member of the allowed set');
  };
}

function clampedNumber(min: number, max: number, round = false): (value: unknown) => number {
  return (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error('value is not a finite number');
    }
    const v = round ? Math.round(value) : value;
    return Math.min(max, Math.max(min, v));
  };
}

function bool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  throw new Error('value is not a boolean');
}

function httpsUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('value is not a string');
  const parsed = new URL(value); // throws on a non-URL string
  if (parsed.protocol !== 'https:') throw new Error('URL is not https:');
  return value;
}

/** One validator per `Settings` field; failure ⇒ fall back to `DEFAULT_SETTINGS[key]`. */
const VALIDATORS: { [K in keyof Settings]: Validator<K> } = {
  theme: inEnum(ACCENT_THEMES),
  glassLevel: clampedNumber(GLASS_LEVEL_MIN, GLASS_LEVEL_MAX),
  motion: inEnum(MOTION_PREFERENCES),
  defaultQuality: inEnum(QUALITY_PREFERENCES),
  defaultSpeed: clampedNumber(SPEED_MIN, SPEED_MAX),
  autoplay: bool,
  historyEnabled: bool,
  sponsorBlockEnabled: bool,
  sponsorBlockBaseUrl: httpsUrl,
  thumbnailCacheMb: clampedNumber(THUMBNAIL_CACHE_MB_MIN, Number.MAX_SAFE_INTEGER, true),
};

function assignValid<K extends keyof Settings>(out: Settings, key: K, value: unknown): void {
  out[key] = VALIDATORS[key](value);
}

/**
 * Real per-field validation (review F2). Both the renderer-supplied patch and
 * the on-disk file are untrusted. Every known key is checked against its own
 * validator; any failure keeps the default for that key. The result is rebuilt
 * key-by-key from `DEFAULT_SETTINGS`, so unknown keys are dropped rather than
 * persisted forever.
 */
export function coerce(raw: unknown): Settings {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (!(key in source)) continue;
    try {
      assignValid(out, key, source[key]);
    } catch {
      /* keep DEFAULT_SETTINGS[key] */
    }
  }
  return out;
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
