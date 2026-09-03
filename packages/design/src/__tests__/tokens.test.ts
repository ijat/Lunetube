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

describe('glass material opacity (decision A4)', () => {
  it('defaults --glass-material-opacity to 0.7', () => {
    const glass = read('tokens/glass.css');
    expect(glass).toMatch(/--glass-material-opacity:\s*0\.7\s*;/);
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
