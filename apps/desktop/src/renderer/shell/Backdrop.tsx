/**
 * The living backdrop (PRD §7 / mockup direction B): two drifting radial washes
 * driven by `--wash-a` / `--wash-b` (34s / 42s), styled in `styles/global.css`.
 * At rest the washes follow the accent theme; on the watch route
 * `DominantColorWash` re-tints them from the video's thumbnail (P1-6).
 *
 * Both use low alphas (≈0.12 / 0.08 — step P2-G / decision A21) so the blobs
 * are a faint tint floating over the OS material, not a wash that fights the
 * window's translucency.
 */
export function Backdrop() {
  return <div className="backdrop" aria-hidden="true" />;
}
