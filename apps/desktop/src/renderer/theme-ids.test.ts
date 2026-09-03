import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCENT_THEMES, ACCENT_THEME_LABELS } from '@lunetube/shared';

/**
 * F10 — one source of truth for the accent-theme id set. This fails CI if
 * `ACCENT_THEMES` (shared, canonical) ever drifts from the generated theme CSS
 * (which the codegen derives from `THEME_ORDER` + the source JSONs, both
 * guarded by throws in gen-theme-css.mjs).
 */
// vitest runs from the repo root.
const themesCss = readFileSync(
  join(process.cwd(), 'packages/design/src/themes/generated/themes.css'),
  'utf8',
);

describe('accent themes stay in sync', () => {
  it('generated themes.css declares exactly ACCENT_THEMES, in order', () => {
    const declared = [...themesCss.matchAll(/\[data-theme='([^']+)'\]/g)].map((m) => m[1] ?? '');
    expect(declared).toEqual([...ACCENT_THEMES]);
  });

  it('every accent theme has a label and there are no extras', () => {
    expect(Object.keys(ACCENT_THEME_LABELS).sort()).toEqual([...ACCENT_THEMES].sort());
  });

  it('every theme block emits a distinct --glass-tint-rgb (F8)', () => {
    const tints = [...themesCss.matchAll(/--glass-tint-rgb:\s*([^;]+);/g)].map((m) =>
      (m[1] ?? '').trim(),
    );
    expect(tints).toHaveLength(ACCENT_THEMES.length);
    expect(new Set(tints).size).toBeGreaterThan(1);
  });
});
