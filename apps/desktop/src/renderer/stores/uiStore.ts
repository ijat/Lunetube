import { create } from 'zustand';
import { ACCENT_THEMES, DEFAULT_SETTINGS, type AccentTheme, type Settings } from '@lunetube/shared';

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
    document.documentElement.style.setProperty(
      '--glass-material-opacity',
      String(settings.glassLevel),
    );
    set({ theme: settings.theme, glassLevel: settings.glassLevel, settingsLoaded: true });
  },

  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
    void window.lune.invoke('app:setSettings', { patch: { theme } });
  },

  cycleTheme: () => {
    const idx = ACCENT_THEMES.indexOf(get().theme);
    const next = ACCENT_THEMES[(idx + 1) % ACCENT_THEMES.length] ?? 'blue';
    get().setTheme(next);
  },

  setGlassLevel: (glassLevel) => {
    const clamped = Math.min(1, Math.max(0.4, glassLevel));
    document.documentElement.style.setProperty('--glass-material-opacity', String(clamped));
    set({ glassLevel: clamped });
    void window.lune.invoke('app:setSettings', { patch: { glassLevel: clamped } });
  },

  setSearchQuery: (searchQuery) => set({ searchQuery }),
}));
