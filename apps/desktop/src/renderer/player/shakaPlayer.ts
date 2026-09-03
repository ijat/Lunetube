import shaka from 'shaka-player';
import {
  SHAKA_ERROR_CODE,
  SHAKA_REQUEST_TYPE_SEGMENT,
  type ShakaPlayerLike,
} from './PlaybackEngine.js';

/**
 * The only module in the renderer that imports shaka (F3/F6: `shaka-player@5.2.8`,
 * zero dependencies, UMD — no `exports` map, so Vite resolves it through `main`
 * and rollup's commonjs interop hands us the namespace as the default export).
 *
 * It exists so `PlaybackEngine.ts` can stay shaka-free and unit-testable. Two
 * guards live here, both cheap and both real:
 *
 * 1. **Type conformance.** `createShakaPlayer()` is declared to return
 *    `ShakaPlayerLike`, so `tsc` proves that the real `shaka.Player` still has
 *    every method the engine calls, with compatible signatures. A shaka upgrade
 *    that renames `selectVideoTrack` breaks `pnpm typecheck`, not playback.
 * 2. **Enum conformance.** The engine keys recovery off numeric error codes it
 *    declares as literals. `assertShakaConstants()` checks them against shaka's
 *    own enums at module load, so a renumbering surfaces immediately instead of
 *    silently switching the 403-recovery loop off.
 */

let installed = false;

/** Throws if shaka's enums no longer match the literals in `PlaybackEngine.ts`. */
export function assertShakaConstants(): void {
  const mismatches: string[] = [];
  if (Number(shaka.util.Error.Code.BAD_HTTP_STATUS) !== SHAKA_ERROR_CODE.BAD_HTTP_STATUS) {
    mismatches.push(
      `BAD_HTTP_STATUS ${String(shaka.util.Error.Code.BAD_HTTP_STATUS)} != ${SHAKA_ERROR_CODE.BAD_HTTP_STATUS}`,
    );
  }
  if (Number(shaka.util.Error.Code.HTTP_ERROR) !== SHAKA_ERROR_CODE.HTTP_ERROR) {
    mismatches.push(
      `HTTP_ERROR ${String(shaka.util.Error.Code.HTTP_ERROR)} != ${SHAKA_ERROR_CODE.HTTP_ERROR}`,
    );
  }
  if (Number(shaka.net.NetworkingEngine.RequestType.SEGMENT) !== SHAKA_REQUEST_TYPE_SEGMENT) {
    mismatches.push(
      `RequestType.SEGMENT ${String(shaka.net.NetworkingEngine.RequestType.SEGMENT)} != ${SHAKA_REQUEST_TYPE_SEGMENT}`,
    );
  }
  if (mismatches.length > 0) {
    throw new Error(
      `shaka-player constants drifted — stream recovery would silently stop working: ${mismatches.join('; ')}`,
    );
  }
}

/** `true` when this Chromium build can run shaka at all (MSE present, etc.). */
export function isPlaybackSupported(): boolean {
  return shaka.Player.isBrowserSupported();
}

export function createShakaPlayer(): ShakaPlayerLike {
  if (!installed) {
    assertShakaConstants();
    shaka.polyfill.installAll();
    installed = true;
  }
  return new shaka.Player();
}

export { shaka };
