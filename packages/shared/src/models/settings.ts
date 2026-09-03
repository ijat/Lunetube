export type AccentTheme = 'blue' | 'purple' | 'green' | 'orange' | 'dark-modern';

export const ACCENT_THEMES: readonly AccentTheme[] = [
  'blue',
  'purple',
  'green',
  'orange',
  'dark-modern',
] as const;

export type MotionPreference = 'full' | 'reduced' | 'system';

export type QualityPreference = 'auto' | '2160' | '1440' | '1080' | '720' | '480' | '360';

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
