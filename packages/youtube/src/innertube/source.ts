/**
 * `YouTubeSource` backed by youtubei.js (InnerTube).
 *
 * This file, `session.ts` and `errors.ts` are the only three allowed to import
 * `youtubei.js`. Everything it returns is a plain `@lunetube/shared` DTO.
 *
 * Phase 1 scope: `getVideo`, `getStreams`, `getRelated`, `getDiagnostics`. The
 * seven Phase-2 methods return a `NOT_IMPLEMENTED` `LuneError`.
 *
 * P1-3 will lift `getStreams`' manifest assembly into a `PlaybackStrategy`
 * (`../playback/`) and add the URL-expiry / 403 recovery loop; the per-item
 * mappers in `map/streams.ts` are already the pieces it needs.
 */
import type { Innertube } from 'youtubei.js';
import {
  err,
  makeLuneError,
  ok,
  type AdapterDiagnostics,
  type ChannelDetail,
  type Comment,
  type CommentPage,
  type LuneError,
  type NavTarget,
  type Paged,
  type PlaylistDetail,
  type Result,
  type SearchPage,
  type StreamManifest,
  type StreamPrefs,
  type VideoDetail,
  type VideoSummary,
} from '@lunetube/shared';
import {
  identityRewriter,
  type GetChannelParams,
  type GetCommentRepliesParams,
  type GetCommentsParams,
  type GetPlaylistParams,
  type GetRelatedParams,
  type MediaUrlRewriters,
  type SearchParams,
  type YouTubeSource,
} from '../contract.js';
import { attemptableClients, CLIENT_LADDER, type InnerTubeClient } from './clients.js';
import { ContinuationStore } from './continuations.js';
import { mapPlayabilityStatus, mapYoutubeError, notImplemented } from './errors.js';
import { InnertubeSession, youtubeiVersion, type InnertubeSessionOptions } from './session.js';
import { mapChapters } from './map/chapters.js';
import { mapAudioTracks, mapCaptionTracks, mapStoryboards, mapVideoTracks } from './map/streams.js';
import { mapDescription, mapFeedVideos, mapVideoDetail, type RawVideoInfo } from './map/video.js';

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

export interface InnertubeYouTubeSourceOptions {
  /** Persistent InnerTube cache directory (resolved by main under `userData`). */
  cacheDir: string;
  /** URL rewriters for the loopback proxy. `image` / `caption` default to identity. */
  rewriters: MediaUrlRewriters;
  /** Test seam — inject a pre-built session (and thus a fake `Innertube`). */
  session?: InnertubeSession;
  /** Test seam forwarded to `InnertubeSession` when `session` is not given. */
  createInnertube?: InnertubeSessionOptions['createInnertube'];
}

interface LadderState {
  ok: boolean;
  formats: number;
  lastError: string | null;
}

export class InnertubeYouTubeSource implements YouTubeSource {
  readonly #session: InnertubeSession;
  readonly #rewriteMedia: (url: URL) => URL;
  readonly #rewriteImage: (url: URL) => URL;
  readonly #rewriteCaption: (url: URL) => URL;
  readonly #related = new ContinuationStore();
  readonly #ladder = new Map<InnerTubeClient, LadderState>();
  #lastClient: string | null = null;

  constructor(opts: InnertubeYouTubeSourceOptions) {
    this.#session =
      opts.session ??
      new InnertubeSession({
        cacheDir: opts.cacheDir,
        ...(opts.createInnertube ? { createInnertube: opts.createInnertube } : {}),
      });
    this.#rewriteMedia = opts.rewriters.media;
    this.#rewriteImage = opts.rewriters.image ?? identityRewriter;
    this.#rewriteCaption = opts.rewriters.caption ?? identityRewriter;
  }

  async getVideo(params: { videoId: string }): Promise<Result<VideoDetail, LuneError>> {
    const videoId = normalizeId(params.videoId);
    if (videoId == null) return err(invalidId());

    return this.#guard(async (yt) => {
      const info = await yt.getInfo(videoId);
      const playErr = mapPlayabilityStatus(info.playability_status);
      const detail = mapVideoDetail(info as unknown as RawVideoInfo);
      if (detail == null) {
        return err(playErr ?? parseChanged('getVideo: no basic_info.id'));
      }
      if (detail.title === '' && playErr != null) return err(playErr);
      return ok(detail);
    });
  }

  async getStreams(params: {
    videoId: string;
    prefs: StreamPrefs;
  }): Promise<Result<StreamManifest, LuneError>> {
    const videoId = normalizeId(params.videoId);
    if (videoId == null) return err(invalidId());

    const candidates = attemptableClients();
    if (candidates.length === 0) {
      return err(
        makeLuneError('PLAYBACK_FORBIDDEN', 'No usable InnerTube client is available.', {
          hint: 'Every ladder entry needs a Proof-of-Origin token or the SABR strategy, neither of which exists yet.',
        }),
      );
    }

    let lastError: LuneError = makeLuneError('YT_UNAVAILABLE', 'No client produced a stream.');
    for (const entry of candidates) {
      const attempt = await this.#guard((yt) =>
        this.#resolveStreams(yt, videoId, entry.client, params.prefs),
      );
      if (attempt.ok) return attempt;
      lastError = attempt.error;
      // A login/bot block on one client won't be fixed by trying another we
      // already know needs a PO token — but keep walking for parser breaks.
      if (attempt.error.code === 'YT_LOGIN_REQUIRED') break;
    }
    return err(lastError);
  }

  async #resolveStreams(
    yt: Innertube,
    videoId: string,
    client: InnerTubeClient,
    prefs: StreamPrefs,
  ): Promise<Result<StreamManifest, LuneError>> {
    const state: LadderState = { ok: false, formats: 0, lastError: null };
    this.#ladder.set(client, state);
    try {
      const info = await yt.getInfo(videoId, { client });
      const playErr = mapPlayabilityStatus(info.playability_status);
      if (playErr != null) {
        state.lastError = playErr.message;
        return err(playErr);
      }

      const adaptive = info.streaming_data?.adaptive_formats ?? [];
      const video = mapVideoTracks(adaptive, this.#rewriteMedia);
      const audio = mapAudioTracks(adaptive, this.#rewriteMedia);
      if (video.length === 0 && audio.length === 0) {
        const e = makeLuneError(
          'YT_UNAVAILABLE',
          `Client ${client} returned no playable formats.`,
          {
            detail: `client:${client}`,
            hint: 'This usually means the client is SABR-only or needs a PO token from this IP.',
          },
        );
        state.lastError = e.message;
        return err(e);
      }

      const manifestXml = await info.toDash({
        url_transformer: this.#rewriteMedia,
        manifest_options: { captions_format: 'vtt' },
      });

      const raw = info as unknown as RawVideoInfo;
      const durationSec = numberOr(info.basic_info.duration, 0);
      const description = mapDescription(raw);
      const manifest: StreamManifest = {
        kind: 'dash',
        manifestXml,
        video,
        audio,
        captions: mapCaptionTracks(info.captions, this.#rewriteCaption),
        storyboards: mapStoryboards(
          info.storyboards as unknown as Parameters<typeof mapStoryboards>[0],
          this.#rewriteImage,
        ),
        chapters: mapChapters({ overlays: raw.player_overlays, description, durationSec }),
        isLive: info.basic_info.is_live === true,
        durationSec,
        expiresAt: streamExpiry(info.streaming_data, video, audio),
        client,
      };

      state.ok = true;
      state.formats = video.length + audio.length;
      this.#lastClient = client;
      // `prefs` (maxHeight / audioOnly / preferredAudioLanguage) is applied by
      // the renderer's track selection in Phase 1; P1-3 pushes it down into a
      // `format_filter` on `toDash()` and the DTO track lists.
      void prefs;
      return ok(manifest);
    } catch (e) {
      const mapped = mapYoutubeError(e);
      state.lastError = mapped.message;
      throw e;
    }
  }

  async getRelated(params: GetRelatedParams): Promise<Result<Paged<VideoSummary>, LuneError>> {
    const videoId = normalizeId(params.videoId);
    if (videoId == null) return err(invalidId());

    return this.#guard(async (yt) => {
      if (params.continuation != null) {
        const stored = this.#related.get(params.continuation);
        if (stored == null) {
          return err(
            makeLuneError('INVALID_INPUT', 'Unknown or expired related-videos continuation.', {
              hint: 'Reload the video to start a fresh related feed.',
            }),
          );
        }
        const next = await (
          stored as { getWatchNextContinuation(): Promise<unknown> }
        ).getWatchNextContinuation();
        return ok(this.#pageFromWatchNext(next));
      }

      const info = await yt.getInfo(videoId);
      return ok(this.#pageFromWatchNext(info));
    });
  }

  #pageFromWatchNext(info: unknown): Paged<VideoSummary> {
    const feed = (info as { watch_next_feed?: unknown }).watch_next_feed;
    const items = mapFeedVideos(feed as never);
    const hasMore = (info as { wn_has_continuation?: unknown }).wn_has_continuation === true;
    if (!hasMore) return { items };
    return { items, continuation: this.#related.put(info) };
  }

  async getDiagnostics(): Promise<Result<AdapterDiagnostics, LuneError>> {
    const ladder = CLIENT_LADDER.map((entry) => {
      const state = this.#ladder.get(entry.client);
      return {
        client: entry.client,
        ok: state?.ok ?? false,
        formats: state?.formats ?? 0,
        lastError: state?.lastError ?? null,
      };
    });
    return ok({
      youtubeiVersion: youtubeiVersion(),
      lastClient: this.#lastClient,
      ladder,
    });
  }

  // ---- Phase 2 ----
  async search(_params: SearchParams): Promise<Result<SearchPage, LuneError>> {
    return err(notImplemented('search'));
  }
  async getSearchSuggestions(_params: { query: string }): Promise<Result<string[], LuneError>> {
    return err(notImplemented('getSearchSuggestions'));
  }
  async getComments(_params: GetCommentsParams): Promise<Result<CommentPage, LuneError>> {
    return err(notImplemented('getComments'));
  }
  async getCommentReplies(
    _params: GetCommentRepliesParams,
  ): Promise<Result<Paged<Comment>, LuneError>> {
    return err(notImplemented('getCommentReplies'));
  }
  async getChannel(
    _params: GetChannelParams,
  ): Promise<Result<ChannelDetail | Paged<VideoSummary>, LuneError>> {
    return err(notImplemented('getChannel'));
  }
  async getPlaylist(_params: GetPlaylistParams): Promise<Result<PlaylistDetail, LuneError>> {
    return err(notImplemented('getPlaylist'));
  }
  async resolveUrl(_params: { url: string }): Promise<Result<NavTarget, LuneError>> {
    return err(notImplemented('resolveUrl'));
  }

  /**
   * Runs `fn` with the shared `Innertube`. On a parser break, refreshes the
   * session (new player JS) and retries exactly once. Any throw becomes a
   * `LuneError`.
   */
  async #guard<T>(
    fn: (yt: Innertube) => Promise<Result<T, LuneError>>,
  ): Promise<Result<T, LuneError>> {
    try {
      return await fn(await this.#session.get());
    } catch (first) {
      const mapped = mapYoutubeError(first);
      if (mapped.code !== 'YT_PARSE_CHANGED') return err(mapped);
      try {
        return await fn(await this.#session.refresh());
      } catch (second) {
        return err(mapYoutubeError(second));
      }
    }
  }
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[\w-]{6,20}$/.test(trimmed) ? trimmed : null;
}

function invalidId(): LuneError {
  return makeLuneError('INVALID_INPUT', 'Not a valid YouTube video id.');
}

function parseChanged(detail: string): LuneError {
  return makeLuneError('YT_PARSE_CHANGED', 'YouTube returned an unexpected shape.', { detail });
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function streamExpiry(
  streamingData: { expires?: unknown } | undefined,
  video: { url: string }[],
  audio: { url: string }[],
): number {
  const expires = streamingData?.expires;
  if (expires instanceof Date && Number.isFinite(expires.getTime())) return expires.getTime();
  if (typeof expires === 'string') {
    const t = Date.parse(expires);
    if (Number.isFinite(t)) return t;
  }
  const sample = video[0]?.url ?? audio[0]?.url;
  if (sample != null) {
    try {
      const expire = new URL(sample).searchParams.get('expire');
      const seconds = expire == null ? NaN : Number(expire);
      if (Number.isFinite(seconds) && seconds > 0) return Math.trunc(seconds * 1000);
    } catch {
      // ignore
    }
  }
  return Date.now() + FIVE_HOURS_MS;
}
