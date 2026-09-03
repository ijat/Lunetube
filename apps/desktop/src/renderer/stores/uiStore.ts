import { create } from 'zustand';
import { bridge } from '../bridge.js';
import {
  ACCENT_THEMES,
  DEFAULT_SETTINGS,
  clampGlassLevel,
  type AccentTheme,
  type Settings,
} from '@lunetube/shared';

interface UiState {
  theme: AccentTheme;
  glassLevel: number;
  settingsLoaded: boolean;
  searchQuery: string;
  hydrate: (settings: Settings) => void;
  setTheme: (theme: AccentTheme) => void;
  cycleTheme: () => void;
  setGlassLevel: (level: number) => void;
  setSearchQuery: (q: string) => void;
}

function applyTheme(theme: AccentTheme): void {
  document.documentElement.dataset['theme'] = theme;
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: DEFAULT_SETTINGS.theme,
  glassLevel: DEFAULT_SETTINGS.glassLevel,
  settingsLoaded: false,
  searchQuery: '',

  hydrate: (settings) => {
    applyTheme(settings.theme);
    const glassLevel = clampGlassLevel(settings.glassLevel);
    document.documentElement.style.setProperty('--glass-material-opacity', String(glassLevel));
    set({ theme: settings.theme, glassLevel, settingsLoaded: true });
  },

  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
    void bridge().invoke('app:setSettings', { patch: { theme } });
  },

  cycleTheme: () => {
    const idx = ACCENT_THEMES.indexOf(get().theme);
    const next = ACCENT_THEMES[(idx + 1) % ACCENT_THEMES.length] ?? 'blue';
    get().setTheme(next);
  },

  setGlassLevel: (glassLevel) => {
    const clamped = clampGlassLevel(glassLevel);
    document.documentElement.style.setProperty('--glass-material-opacity', String(clamped));
    set({ glassLevel: clamped });
    void bridge().invoke('app:setSettings', { patch: { glassLevel: clamped } });
  },

  setSearchQuery: (searchQuery) => set({ searchQuery }),
}));
