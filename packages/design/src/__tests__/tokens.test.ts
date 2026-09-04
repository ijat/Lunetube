import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..');

const read = (rel: string) => readFileSync(join(src, rel), 'utf8');

const generatedThemes = read('themes/generated/themes.css');

const tokenCss = [
  'tokens/base.css',
  'tokens/typography.css',
  'tokens/layout.css',
  'tokens/glass.css',
  'primitives/primitives.css',
  'fonts/fonts.css',
  'themes/generated/themes.css',
]
  .map(read)
  .join('\n');

describe('generated theme CSS', () => {
  it("emits blue's Lunegit accent #71B0F7 as rgb(113 176 247 ...)", () => {
    expect(generatedThemes).toContain("[data-theme='blue']");
    expect(generatedThemes).toContain('--accent: rgb(113 176 247');
    expect(generatedThemes).toContain('--accent-primary-color: rgb(113 176 247 / 1)');
  });

  it('contains all five accent themes', () => {
    for (const name of ['blue', 'purple', 'green', 'orange', 'dark-modern']) {
      expect(generatedThemes).toContain(`[data-theme='${name}']`);
    }
  });

  it('converts 6-digit #RRGGBB values (purple/orange GlassTintColor) to opaque rgb()', () => {
    // purple.json GlassTintColor = #140A1F -> 20 10 31
    expect(generatedThemes).toContain('--glass-tint-color: rgb(20 10 31 / 1)');
    // orange.json GlassTintColor = #1A0E08 -> 26 14 8
    expect(generatedThemes).toContain('--glass-tint-color: rgb(26 14 8 / 1)');
  });

  it("exposes each theme's higher glass opacity as an option, not as the active value", () => {
    expect(generatedThemes).toContain('--glass-opacity-option: 0.85');
    expect(generatedThemes).toContain('--glass-opacity-option: 0.98');
  });

  it('emits a per-theme --glass-tint-rgb that differs blue vs purple (F8)', () => {
    const tintFor = (theme: string) => {
      const block = generatedThemes.slice(generatedThemes.indexOf(`[data-theme='${theme}']`));
      return /--glass-tint-rgb:\s*([^;]+);/.exec(block)?.[1]?.trim();
    };
    // blue GlassTintColor #FF0A121F -> 10 18 31; purple #140A1F -> 20 10 31
    expect(tintFor('blue')).toBe('10 18 31');
    expect(tintFor('purple')).toBe('20 10 31');
    expect(tintFor('blue')).not.toBe(tintFor('purple'));
  });

  it('no longer hardcodes --accent-ink per theme (F17 — it lives once in base.css)', () => {
    expect(generatedThemes).not.toContain('--accent-ink');
    expect(read('tokens/base.css')).toContain('--accent-ink:');
  });
});

describe('typography lock (PRD §7)', () => {
  it('declares no fixed-pitch font family anywhere in the token layer', () => {
    expect(tokenCss).not.toMatch(/mono(space)?/i);
  });

  it('ships the tabular-nums utility for numerals', () => {
    expect(tokenCss).toContain('font-variant-numeric: tabular-nums');
  });

  it('uses Hanken Grotesk for body and Bricolage Grotesque for display', () => {
    expect(tokenCss).toContain("'Hanken Grotesk'");
    expect(tokenCss).toContain("'Bricolage Grotesque'");
  });
});

describe('glass material opacity (decision A4, lowered for real-glass)', () => {
  it('defaults --glass-material-opacity to 0.34 (was 0.7 before OS vibrancy/acrylic)', () => {
    const glass = read('tokens/glass.css');
    expect(glass).toMatch(/--glass-material-opacity:\s*0\.34\s*;/);
  });

  it('centralises every blur value as a token, including the top bar (F8)', () => {
    const glass = read('tokens/glass.css');
    expect(glass).toMatch(/--blur-bar:\s*24px\s*;/);
    // .glass-root reads the per-theme tint token, not a hardcoded colour.
    expect(glass).toContain('rgb(var(--glass-tint-rgb) / var(--glass-material-opacity))');
  });
});

describe('real-glass design-system pass (step P2-G / decision A21)', () => {
  it('exposes a --text-shadow-glass token for small chrome text over the OS material', () => {
    const glass = read('tokens/glass.css');
    expect(glass).toMatch(/--text-shadow-glass:\s*0 1px 2px rgb\(0 0 0 \/ 0\.35\)\s*;/);
  });

  it('resets the glass shadow to none on large display type', () => {
    expect(read('tokens/typography.css')).toMatch(/\.display\s*\{[^}]*text-shadow:\s*none/);
  });

  it('lowers the backdrop wash alphas so they sit on vibrancy instead of an opaque window', () => {
    // Per-theme defaults (generated) — halved from 0.20 / 0.13, glow kept near 0.30.
    expect(generatedThemes).toMatch(/--wash-a: rgb\(\d+ \d+ \d+ \/ 0\.12\);/);
    expect(generatedThemes).toMatch(/--wash-b: rgb\(\d+ \d+ \d+ \/ 0\.08\);/);
    expect(generatedThemes).toMatch(/--glow: rgb\(\d+ \d+ \d+ \/ 0\.3\);/);
    expect(generatedThemes).not.toMatch(/--wash-a: rgb\(\d+ \d+ \d+ \/ 0\.20?\);/);
    // Literal fallbacks in base.css match.
    const base = read('tokens/base.css');
    expect(base).toMatch(/--wash-a: rgb\(113 176 247 \/ 0\.12\);/);
    expect(base).toMatch(/--wash-b: rgb\(113 176 247 \/ 0\.08\);/);
    expect(base).toMatch(/--glow: rgb\(113 176 247 \/ 0\.3\);/);
  });
});

describe('self-hosted fonts (decision A7)', () => {
  it('never links the Google Fonts CDN', () => {
    expect(tokenCss).not.toContain('fonts.googleapis.com');
    expect(tokenCss).not.toContain('fonts.gstatic.com');
  });

  it('references vendored local woff2 files', () => {
    const fonts = read('fonts/fonts.css');
    expect(fonts).toContain("url('./hanken-grotesk-latin.woff2')");
    expect(fonts).toContain("url('./bricolage-grotesque-latin.woff2')");
  });
});
