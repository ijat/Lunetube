import { describe, expect, it } from 'vitest';
import shaka from 'shaka-player';
import {
  SHAKA_ERROR_CODE,
  SHAKA_ERROR_SEVERITY,
  SHAKA_REQUEST_TYPE_SEGMENT,
} from '../PlaybackEngine.js';
import { assertShakaConstants } from '../shakaPlayer.js';

/**
 * Runtime half of the shaka guard (the compile-time half is `shakaPlayer.ts`
 * declaring `createShakaPlayer(): ShakaPlayerLike`).
 *
 * shaka 5.2.8 ships as a UMD bundle with **no `exports` map and no `module`
 * field**, so Vite resolves it through `main` and rollup's CommonJS interop has
 * to synthesise the default export. This test runs through the same Vite
 * pipeline the renderer build uses, so if that interop ever breaks — an ESM
 * migration, a Vite 8 resolver change — it fails here rather than at runtime in
 * a packaged app.
 *
 * It also pins the numeric enum values `PlaybackEngine.ts` hard-codes. Those
 * literals are what switch the 403-recovery loop on; a silent renumbering on a
 * shaka upgrade would disable recovery without a single test going red.
 */
describe('shaka-player interop', () => {
  it('resolves to the shaka namespace through Vite CommonJS interop', () => {
    expect(shaka).toBeTypeOf('object');
    expect(shaka.Player).toBeTypeOf('function');
    expect(shaka.Player.isBrowserSupported).toBeTypeOf('function');
    expect(shaka.polyfill.installAll).toBeTypeOf('function');
    expect(shaka.util.Error).toBeTypeOf('function');
    expect(shaka.net.NetworkingEngine).toBeTypeOf('function');
  });

  it('still numbers the error codes the recovery loop keys on', () => {
    expect(shaka.util.Error.Code.BAD_HTTP_STATUS).toBe(SHAKA_ERROR_CODE.BAD_HTTP_STATUS);
    expect(shaka.util.Error.Code.HTTP_ERROR).toBe(SHAKA_ERROR_CODE.HTTP_ERROR);
    expect(shaka.net.NetworkingEngine.RequestType.SEGMENT).toBe(SHAKA_REQUEST_TYPE_SEGMENT);
    expect(shaka.util.Error.Severity.RECOVERABLE).toBe(SHAKA_ERROR_SEVERITY.RECOVERABLE);
    expect(shaka.util.Error.Severity.CRITICAL).toBe(SHAKA_ERROR_SEVERITY.CRITICAL);
    expect(() => assertShakaConstants()).not.toThrow();
  });
});
