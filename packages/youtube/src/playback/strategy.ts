/**
 * The **playback strategy seam** (plan "Approach → which playback strategy",
 * decision A6).
 *
 * A strategy turns one already-fetched `VideoInfo`-shaped object into a
 * `StreamManifest` DTO the renderer's shaka player can load. Phase 1 ships
 * exactly one — `ClassicDashStrategy` (`./classicDash.ts`), the verified
 * IOS-client → `toDash()` path. `./sabr.ts` is the named, empty slot for the
 * protocol YouTube is migrating to (plan F3). Swapping is one constructor
 * argument (`InnertubeYouTubeSourceOptions.strategy`), not a rewrite — that is
 * the whole point of this file, and the mitigation for plan risk R1.
 *
 * **Nothing here may import `youtubei.js`** (ESLint enforces it outside
 * `src/innertube/**`), so `PlaybackInfo` is a *structural* view of the parts of
 * `VideoInfo` a strategy reads. Two consequences, both deliberate:
 *
 * - `InnertubeYouTubeSource` performs one documented cast at the seam
 *   (`src/innertube/source.ts`), because youtubei.js' concrete classes are
 *   structurally close to — but not assignable to — these loose `unknown`-typed
 *   mapper inputs.
 * - a plain fixture object plus a `toDash` function *is* a `PlaybackInfo`, which
 *   is what lets `FakeYouTubeSource` and the unit tests drive the real strategy
 *   with no network and no `Innertube.create()`.
 */
import type { LuneError, Result, StreamManifest, StreamPrefs } from '@lunetube/shared';
import type { RawCaptions, RawStoryboards, RawStreamingData } from '../innertube/map/streams.js';
import type { RawVideoInfo } from '../innertube/map/video.js';

/** `(upstream URL) → (loopback proxy URL)`. Injected; see `MediaUrlRewriters`. */
export type UrlRewriter = (url: URL) => URL;

/**
 * `manifest_options` as accepted by youtubei.js v18.0.0's
 * `MediaInfo.toDash()` (`StreamingInfoOptions`), narrowed to the keys a
 * strategy sets.
 *
 * **`include_thumbnails` is deliberately absent.** It exists at runtime
 * (`MediaInfo.js` gates `player_response.storyboards` on it) but is *not* in
 * v18.0.0's published `StreamingInfoOptions` type, and its default is falsy —
 * so omitting the key is exactly equivalent to the plan's
 * `include_thumbnails: false`, without a cast. Keeping storyboards out of the
 * manifest also avoids up to ten HEAD requests per board that youtubei.js fires
 * to measure storyboard sheets (`StreamingInfo.js#getStoryboardBitrate`); the
 * DTO carries `storyboards[]` instead, mapped locally and for free.
 */
export interface DashManifestOptions {
  captions_format?: 'vtt' | 'ttml';
  /** SABR-flavoured URLs. Unused in Phase 1; the slot the SABR strategy needs. */
  is_sabr?: boolean;
}

/** The `toDash()` argument object. */
export interface DashRequest {
  url_transformer?: UrlRewriter;
  manifest_options?: DashManifestOptions;
}

/**
 * The structural subset of youtubei.js' `VideoInfo` that a strategy reads.
 * Extends `RawVideoInfo` so the description/chapter mappers apply unchanged.
 */
export interface PlaybackInfo extends RawVideoInfo {
  streaming_data?: RawStreamingData | null;
  captions?: RawCaptions | null;
  storyboards?: RawStoryboards | null;
  toDash(options?: DashRequest): Promise<string>;
}

/**
 * Everything a strategy needs that is *not* video data.
 *
 * All three rewriters are **required**. youtubei.js routes media, caption and
 * storyboard URLs through the *same* `url_transformer`, so a strategy has to
 * demultiplex them onto the proxy's three routes itself — see
 * `classifyManifestUrl` in `./classicDash.ts`. A strategy with only a media
 * rewriter would emit `/media?u=<a timedtext URL>`, which the proxy's
 * `/media` host allow-list rejects: captions would silently die.
 */
export interface PlaybackContext {
  /** InnerTube client that produced `info` — recorded in the DTO + diagnostics. */
  client: string;
  /**
   * User stream preferences.
   *
   * `ClassicDashStrategy` deliberately does **not** filter the manifest by
   * `maxHeight` / `audioOnly`: dropping representations here would stop shaka
   * from ever adapting back up without a full re-resolve. Restriction is the
   * player's job (plan P1-5 `selectVideoHeight`, Phase 4 audio-only), which is
   * why the field is passed down but currently unread by this strategy.
   */
  prefs: StreamPrefs;
  /** googlevideo segment URLs → the proxy's `/media` route. */
  rewriteMedia: UrlRewriter;
  /** ytimg / ggpht / googleusercontent URLs → the proxy's `/img` route. */
  rewriteImage: UrlRewriter;
  /** `youtube.com/api/timedtext` URLs → the proxy's `/caption` route. */
  rewriteCaption: UrlRewriter;
  /**
   * Maps a thrown value onto a `LuneError`. Injected because the real mapper
   * (`src/innertube/errors.ts`) needs youtubei.js' error classes, which this
   * layer may not import. Defaults to a minimal message-based mapper.
   */
  mapError?: (cause: unknown) => LuneError;
  /** Injectable clock — the `now + 5h` expiry fallback has to be testable. */
  now?: () => number;
}

export type PlaybackStrategyId = 'classic-dash' | 'sabr';

export interface PlaybackStrategy {
  readonly id: PlaybackStrategyId;
  resolve(info: PlaybackInfo, ctx: PlaybackContext): Promise<Result<StreamManifest, LuneError>>;
}
