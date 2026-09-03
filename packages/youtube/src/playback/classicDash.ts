/**
 * `ClassicDashStrategy` — the only Phase-1 playback path (decision A6).
 *
 * Classic adaptive formats → youtubei.js `toDash()` → a DASH manifest whose
 * every URL points at the loopback proxy → shaka in the renderer. Verified
 * end to end against the `IOS` client (plan F2).
 *
 * ## Invariants this class exists to preserve
 *
 * 1. **No URL the renderer will fetch escapes a rewriter.** Both channels are
 *    covered: the manifest (via `toDash`'s `url_transformer`) and the DTO's
 *    `video[]` / `audio[]` / `captions[]` / `storyboards[]`. The strategy does
 *    not know what a rewriter *does* — the proxy wiring (P1-4) owns that — so
 *    what it guarantees is "everything goes through the injected function".
 * 2. **Each URL reaches the rewriter for its own proxy route.** youtubei.js
 *    pushes media, caption *and* storyboard URLs through the **same**
 *    `url_transformer` (verified by reading v18.0.0
 *    `utils/StreamingInfo.js#getTextSets` / `#getImageSets`, and reproduced in
 *    `src/innertube/__tests__/dashManifest.test.ts`). Handing it the media
 *    rewriter alone — the literal reading of plan P1-3 — would emit
 *    `/media?u=<a www.youtube.com timedtext URL>`, which the proxy's anchored
 *    `/media` host allow-list rejects, silently killing every caption track.
 *    `classifyManifestUrl` demultiplexes instead.
 * 3. **Expiry is derived from raw URLs, never rewritten ones.** A rewritten URL
 *    hides `expire=` inside a base64url `?u=` payload, so reading it back would
 *    always miss and silently degrade to the `now + 5h` fallback.
 * 4. **A live stream fails loudly, not obscurely.** `toDash()` throws
 *    `InnertubeError('Generating DASH manifests for live videos is not
 *    supported…')` (v18.0.0 `core/mixins/MediaInfo.js`), which would surface as
 *    a bare `INTERNAL`. It is pre-empted with a `NOT_IMPLEMENTED` naming the
 *    real gap.
 *
 * Complexity: linear in the number of adaptive formats (~30–60 for a real
 * video, hard-capped by YouTube's response), with one pass per output list plus
 * `toDash`'s own single pass. Nothing here is quadratic and nothing here does
 * I/O — the only await is `toDash`.
 */
import {
  err,
  isLuneError,
  makeLuneError,
  ok,
  type LuneError,
  type Result,
  type StreamManifest,
} from '@lunetube/shared';
import { mapChapters } from '../innertube/map/chapters.js';
import {
  mapAudioTracks,
  mapCaptionTracks,
  mapStoryboards,
  mapVideoTracks,
  resolveExpiresAt,
  DEFAULT_STREAM_TTL_MS,
} from '../innertube/map/streams.js';
import { mapDescription } from '../innertube/map/video.js';
import { toNumberOrNull } from '../innertube/map/util.js';
import type {
  PlaybackContext,
  PlaybackInfo,
  PlaybackStrategy,
  PlaybackStrategyId,
} from './strategy.js';

/**
 * Which proxy route a URL emitted into the manifest belongs to. Mirrors the
 * shape of the proxy's own anchored allow-lists
 * (`apps/desktop/src/main/proxy/allowlist.ts`) without importing them —
 * `packages/youtube` must stay free of any dependency on the Electron app.
 *
 * The patterns are anchored for the same reason the proxy's are: a suffix test
 * would classify `googlevideo.com.example.net` as media. Misclassification here
 * is not a security hole (the proxy re-checks every target against its own
 * allow-list and is the only thing that actually fetches), it is a
 * broken-playback bug — but it is cheaper to be exact.
 */
const MEDIA_HOST = /^[a-z0-9-]+\.googlevideo\.com$/;
const IMAGE_HOST = /^(?:i\d?\.ytimg\.com|yt\d?\.ggpht\.com|(?:yt|lh)\d?\.googleusercontent\.com)$/;
const TIMEDTEXT_PATHNAME = /^\/api\/timedtext$/;

export type ManifestUrlKind = 'media' | 'image' | 'caption';

export function classifyManifestUrl(url: URL): ManifestUrlKind {
  if (MEDIA_HOST.test(url.hostname)) return 'media';
  if (TIMEDTEXT_PATHNAME.test(url.pathname)) return 'caption';
  if (IMAGE_HOST.test(url.hostname)) return 'image';
  // Unknown shapes fall back to the media route, which is the plan's literal
  // behaviour and fails closed: the proxy rejects anything not googlevideo.
  return 'media';
}

const PARSE_HINT =
  'YouTube changed the shape of its streaming data. This usually clears up after a youtubei.js update.';

export class ClassicDashStrategy implements PlaybackStrategy {
  readonly id: PlaybackStrategyId = 'classic-dash';

  async resolve(
    info: PlaybackInfo,
    ctx: PlaybackContext,
  ): Promise<Result<StreamManifest, LuneError>> {
    if (info.basic_info?.is_live === true) {
      return err(
        makeLuneError('NOT_IMPLEMENTED', 'Live streams cannot be played yet.', {
          detail: 'classic-dash:live',
          hint: 'This build generates a DASH manifest from adaptive formats; YouTube serves live over its own DASH/HLS manifests, which needs a separate playback path.',
        }),
      );
    }

    const adaptive = info.streaming_data?.adaptive_formats ?? [];
    const video = mapVideoTracks(adaptive, ctx.rewriteMedia);
    const audio = mapAudioTracks(adaptive, ctx.rewriteMedia);
    if (video.length === 0 && audio.length === 0) {
      return err(
        makeLuneError('YT_UNAVAILABLE', `Client ${ctx.client} returned no playable formats.`, {
          detail: `client:${ctx.client}`,
          hint: 'This usually means the client is SABR-only or needs a Proof-of-Origin token from this IP address.',
        }),
      );
    }

    const transform = (url: URL): URL => {
      switch (classifyManifestUrl(url)) {
        case 'caption':
          return ctx.rewriteCaption(url);
        case 'image':
          return ctx.rewriteImage(url);
        default:
          return ctx.rewriteMedia(url);
      }
    };

    let manifestXml: string;
    try {
      manifestXml = await info.toDash({
        url_transformer: transform,
        // `include_thumbnails` is intentionally omitted — see DashManifestOptions.
        manifest_options: { captions_format: 'vtt' },
      });
    } catch (cause) {
      return err(toManifestError(cause, ctx));
    }

    if (typeof manifestXml !== 'string' || !manifestXml.includes('<MPD')) {
      return err(
        makeLuneError('YT_PARSE_CHANGED', 'toDash() did not return a DASH manifest.', {
          detail: 'classic-dash:manifest',
          hint: PARSE_HINT,
        }),
      );
    }

    const durationSec = toNumberOrNull(info.basic_info?.duration) ?? 0;
    const description = mapDescription(info);

    return ok({
      kind: 'dash',
      manifestXml,
      video,
      audio,
      captions: mapCaptionTracks(info.captions, ctx.rewriteCaption),
      storyboards: mapStoryboards(info.storyboards, ctx.rewriteImage),
      chapters: mapChapters({ overlays: info.player_overlays, description, durationSec }),
      isLive: false,
      durationSec,
      expiresAt: resolveExpiresAt({
        streamingData: info.streaming_data,
        formats: adaptive,
        fallbackMs: DEFAULT_STREAM_TTL_MS,
        ...(ctx.now ? { now: ctx.now } : {}),
      }),
      client: ctx.client,
    });
  }
}

function toManifestError(cause: unknown, ctx: PlaybackContext): LuneError {
  if (isLuneError(cause)) return cause;
  if (ctx.mapError) return ctx.mapError(cause);
  const message = cause instanceof Error ? cause.message || cause.name : String(cause);
  return makeLuneError('YT_PARSE_CHANGED', message, {
    detail: 'classic-dash:toDash',
    hint: PARSE_HINT,
  });
}
