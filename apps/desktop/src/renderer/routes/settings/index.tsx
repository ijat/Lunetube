import { Panel, Segmented, Slider, THEME_IDS, THEME_LABELS, type ThemeId } from '@lunetube/design';
import { useUiStore } from '../../stores/uiStore.js';

const THEME_OPTIONS = THEME_IDS.map((id) => ({ value: id, label: THEME_LABELS[id] }));

export function SettingsRoute() {
  const theme = useUiStore((s) => s.theme);
  const glassLevel = useUiStore((s) => s.glassLevel);
  const setTheme = useUiStore((s) => s.setTheme);
  const setGlassLevel = useUiStore((s) => s.setGlassLevel);

  return (
    <section className="route">
      <p className="route__kicker">Settings</p>
      <h1 className="route__title">Appearance</h1>

      <Panel className="glass-panel" style={{ display: 'grid', gap: 20, maxWidth: 560 }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <label style={{ fontSize: 13, color: 'var(--fg-2)' }}>Accent theme</label>
          <Segmented<ThemeId>
            options={THEME_OPTIONS}
            value={theme}
            onChange={setTheme}
            ariaLabel="Accent theme"
          />
          <p className="route__note" style={{ fontSize: 12 }}>
            The whole shell re-tints live — backdrop washes, glow and accent.
          </p>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <label style={{ fontSize: 13, color: 'var(--fg-2)' }}>
            Glass level <span className="tnum">({glassLevel.toFixed(2)})</span>
          </label>
          <Slider
            value={glassLevel}
            min={0.4}
            max={1}
            step={0.01}
            onChange={setGlassLevel}
            aria-label="Glass level"
          />
        </div>
      </Panel>
    </section>
  );
}
