export * from './primitives/index.js';
export * from './tokens/motion.js';

/** Accent theme ids, in the order shown in the Settings switcher. */
export const THEME_IDS = ['blue', 'purple', 'green', 'orange', 'dark-modern'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const THEME_LABELS: Record<ThemeId, string> = {
  blue: 'Blue',
  purple: 'Purple',
  green: 'Green',
  orange: 'Orange',
  'dark-modern': 'Dark Modern',
};
