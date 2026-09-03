export type AccentTheme = 'blue' | 'purple' | 'green' | 'orange' | 'dark-modern';

/**
 * The single source of truth for the accent-theme id set and its order (F10).
 * `packages/design/scripts/gen-theme-css.mjs#THEME_ORDER` mirrors this (a build
 * script cannot import TS); the `accent themes stay in sync` test in
 * `apps/desktop/src/renderer/theme-ids.test.ts` fails CI if they ever diverge
 * from each other or from the generated `themes.css`.
 */
export const ACCENT_THEMES: readonly AccentTheme[] = [
  'blue',
  'purple',
  'green',
  'orange',
  'dark-modern',
] as const;

/** Display labels for the Settings accent switcher. */
export const ACCENT_THEME_LABELS: Record<AccentTheme, string> = {
  blue: 'Blue',
  purple: 'Purple',
  green: 'Green',
  orange: 'Orange',
  'dark-modern': 'Dark Modern',
};

export type MotionPreference = 'full' | 'reduced' | 'system';

export const MOTION_PREFERENCES: readonly MotionPreference[] = [
  'full',
  'reduced',
  'system',
] as const;

export type QualityPreference = 'auto' | '2160' | '1440' | '1080' | '720' | '480' | '360';

export const QUALITY_PREFERENCES: readonly QualityPreference[] = [
  'auto',
  '2160',
  '1440',
  '1080',
  '720',
  '480',
  '360',
] as const;

/** Glass material opacity bounds — the single source for every clamp (F11). */
export const GLASS_LEVEL_MIN = 0.4;
export const GLASS_LEVEL_MAX = 1;

export function clampGlassLevel(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.glassLevel;
  return Math.min(GLASS_LEVEL_MAX, Math.max(GLASS_LEVEL_MIN, value));
}

export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;
export const THUMBNAIL_CACHE_MB_MIN = 64;

export interface Settings {
  theme: AccentTheme;
  /** Glass material opacity, 0..1. Default 0.7 (PRD §7 + decision A4). */
  glassLevel: number;
  motion: MotionPreference;
  defaultQuality: QualityPreference;
  defaultSpeed: number;
  autoplay: boolean;
  historyEnabled: boolean;
  sponsorBlockEnabled: boolean;
  sponsorBlockBaseUrl: string;
  thumbnailCacheMb: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'blue',
  glassLevel: 0.7,
  motion: 'system',
  defaultQuality: 'auto',
  defaultSpeed: 1,
  autoplay: true,
  historyEnabled: true,
  sponsorBlockEnabled: true,
  sponsorBlockBaseUrl: 'https://sponsor.ajay.app',
  thumbnailCacheMb: 512,
};
