import { useEffect } from 'react';
import { Vibrant } from 'node-vibrant/browser';
import { loopbackImage } from '../../lib/img.js';

/**
 * Re-tints the living backdrop (`--wash-a` / `--wash-b`) and the ambient player
 * glow (`--glow`) from the dominant colours of the current video's thumbnail
 * (plan P1-6 / mockup direction B).
 *
 * The thumbnail is read through the loopback `/img` proxy — `packages/youtube`
 * has already rewritten `VideoDetail.thumbnailUrl` to it — so `node-vibrant`'s
 * `<img crossorigin="anonymous">` + canvas read stays same-origin and untainted
 * (the `/img` route sets `Access-Control-Allow-Origin`). When the URL is *not* a
 * loopback URL (the `LUNE_FAKE_YT=1` path, where the fake source does not
 * proxy), the wash is skipped and the accent-theme washes stay in place — no
 * fetch is attempted, so nothing trips the CSP.
 *
 * The ~1.1s cross-fade is the CSS `transition` on `.backdrop::before` /
 * `.backdrop::after` (`styles/global.css`); this component only writes the
 * custom properties. `prefers-reduced-motion` is honoured by global.css's
 * reduced-motion block, whose `*, *::before, *::after { transition-duration }`
 * rule collapses the pseudo-element cross-fade — the colour still updates, just
 * instantly.
 *
 * Renders nothing.
 */

const WASH_VARS = ['--wash-a', '--wash-b', '--glow'] as const;

function rgbToken(rgb: [number, number, number], alpha: number): string {
  const [r, g, b] = rgb;
  return `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)} / ${alpha})`;
}

function clearWash(): void {
  for (const name of WASH_VARS) document.documentElement.style.removeProperty(name);
}

/**
 * `@vibrant/image-browser` appends a hidden `<canvas class="@vibrant/canvas">`
 * to `<body>` per extraction and never removes it. Sweep them so a long session
 * of navigating between videos does not accumulate detached-but-attached canvases.
 */
function sweepVibrantCanvases(): void {
  for (const canvas of document.querySelectorAll('canvas')) {
    if (canvas.className === '@vibrant/canvas') canvas.remove();
  }
}

export interface DominantColorWashProps {
  /** Re-runs the extraction whenever this changes. */
  videoId: string;
  /** `VideoDetail.thumbnailUrl` — expected to be a loopback `/img` proxy URL. */
  thumbnailUrl: string | null;
}

export function DominantColorWash({ videoId, thumbnailUrl }: DominantColorWashProps): null {
  useEffect(() => {
    const src = loopbackImage(thumbnailUrl);
    if (src === null) {
      // No proxied thumbnail (e.g. LUNE_FAKE_YT): leave the theme washes alone.
      return;
    }

    let cancelled = false;
    void Vibrant.from(src)
      .getPalette()
      .then((palette) => {
        if (cancelled) return;
        const primary = palette.DarkVibrant ?? palette.Vibrant ?? palette.Muted;
        const secondary =
          palette.DarkMuted ?? palette.Muted ?? palette.Vibrant ?? palette.DarkVibrant;
        const glow = palette.Vibrant ?? palette.LightVibrant ?? primary;
        if (!primary || !secondary || !glow) return;

        // Low alphas (step P2-G / decision A21): over the OS material the
        // backdrop washes compound with the desktop showing through, so this is
        // a hint of the video's colour on the glass, not a wash that fights the
        // translucency. --glow stays the one place the colour still reads.
        const root = document.documentElement.style;
        root.setProperty('--wash-a', rgbToken(primary.rgb, 0.12));
        root.setProperty('--wash-b', rgbToken(secondary.rgb, 0.08));
        root.setProperty('--glow', rgbToken(glow.rgb, 0.3));
      })
      .catch(() => {
        // Colour extraction is a cosmetic enhancement; a failure just leaves the
        // theme washes in place. Deliberately silent — the watch route's e2e
        // gate asserts zero console errors.
      })
      .finally(sweepVibrantCanvases);

    return () => {
      cancelled = true;
      clearWash();
    };
  }, [videoId, thumbnailUrl]);

  return null;
}
