/**
 * `SabrStrategy` — the **named, empty slot** for YouTube's SABR protocol
 * (plan "Approach → Design 2", decision A6). It is deliberately not
 * implemented; it exists so the escape hatch is a visible, typed seam rather
 * than a redesign.
 *
 * ## Why this slot exists (plan F3, risk R1)
 *
 * The Phase-1 path (`./classicDash.ts`) depends on an InnerTube client still
 * handing out directly-playable adaptive URLs. As of the 2026-09-03 probe
 * (plan F2) only `IOS` does; `WEB` already returns **zero** formats with a URL.
 * When that closes, SABR is the path that survives.
 *
 * ## What implementing it requires — all verified against published packages
 *
 * - `googlevideo@4.1.1` (single dependency, `@bufbuild/protobuf`) exports
 *   `googlevideo/sabr-streaming-adapter`: `SabrOptions` plus a
 *   `SabrPlayerAdapter` interface (`initialize`, `getPlayerTime`,
 *   `getPlaybackRate`, `getBandwidthEstimate`, `getActiveTrackFormats`,
 *   `registerRequestInterceptor`, `registerResponseInterceptor`, `dispose`).
 * - **The shaka implementation of `SabrPlayerAdapter` is not published.** It
 *   lives in that repo's `examples/sabr-shaka-example/src/ShakaPlayerAdapter.ts`
 *   and has to be vendored into the renderer.
 * - The manifest side is `toDash({ manifest_options: { is_sabr: true,
 *   captions_format: 'vtt' } })` — the `is_sabr` flag is already carried by
 *   `DashManifestOptions` — which emits `sabr://video?key=<itag>:<xtags>`
 *   pseudo-URLs instead of googlevideo URLs. Those are resolved at playback
 *   time by the adapter, so the **loopback proxy stops being the transport**:
 *   SABR needs `serverAbrStreamingUrl` + `ustreamerConfig` from the player
 *   response, and almost certainly a PO token (`bgutils-js@4.0.3` running
 *   BotGuard in an offscreen `WebContentsView`).
 *
 * That last point is the reason this file is a stub and not a half-built
 * implementation: SABR is not a drop-in replacement for a manifest generator,
 * it changes who fetches the bytes. It is a planned phase of work, and the
 * `PlaybackStrategy` interface is what keeps it a bounded one.
 */
import {
  err,
  makeLuneError,
  type LuneError,
  type Result,
  type StreamManifest,
} from '@lunetube/shared';
import type {
  PlaybackContext,
  PlaybackInfo,
  PlaybackStrategy,
  PlaybackStrategyId,
} from './strategy.js';

export class SabrStrategy implements PlaybackStrategy {
  readonly id: PlaybackStrategyId = 'sabr';

  async resolve(
    _info: PlaybackInfo,
    _ctx: PlaybackContext,
  ): Promise<Result<StreamManifest, LuneError>> {
    return err(
      makeLuneError('NOT_IMPLEMENTED', 'The SABR playback strategy is not implemented.', {
        detail: 'sabr',
        hint: 'Phase 1 plays classic adaptive streams via the IOS client. See packages/youtube/src/playback/sabr.ts for what implementing SABR involves.',
      }),
    );
  }
}
