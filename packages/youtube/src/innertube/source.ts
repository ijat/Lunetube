/**
 * `YouTubeSource` backed by youtubei.js (InnerTube).
 *
 * This file, `session.ts` and `errors.ts` are the only three allowed to import
 * `youtubei.js`. Everything it returns is a plain `@lunetube/shared` DTO.
 *
 * Phase 1 scope: `getVideo`, `getStreams`, `getRelated`, `getDiagnostics`.
 * Phase 2 adds `search`, `getSearchSuggestions` and `resolveUrl` (P2-3); the
 * remaining four (`getComments`, `getCommentReplies`, `getChannel`,
 * `getPlaylist`) still return a `NOT_IMPLEMENTED` `LuneError`.
 *
 * `getStreams` owns **client selection** (walking `CLIENT_LADDER`) and
 * **recovery** (session refresh on a parser break); turning one `VideoInfo`
 * into a `StreamManifest` belongs to the injected `PlaybackStrategy`
 * (`../playback/`). Detecting an *expired* manifest and re-resolving is the
 * renderer's job (plan P1-5) — `StreamManifest.expiresAt` is the contract for
 * it, and calling `getStreams` again is the recovery action.
 */
import type { Innertube } from 'youtubei.js';
import {
  err,
  makeLuneError,
  ok,
  type AdapterDiagnostics,
  type ChannelPage,
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
import {
  CLIENT_LADDER,
  ladderSkipReason,
  type ClientCapabilities,
  type InnerTubeClient,
} from './clients.js';
import { mapPlayabilityStatus, mapYoutubeError, notImplemented } from './errors.js';
import { InnertubeSession, youtubeiVersion, type InnertubeSessionOptions } from './session.js';
import { mapFeedVideos, mapVideoDetail, type RawVideoInfo } from './map/video.js';
import { mapSearchPage, toInnertubeFilters, type RawSearch } from './map/search.js';
import { isValidChannelId, isValidPlaylistId, isValidVideoId, parseYouTubeUrl } from './map/url.js';
import { ContinuationStore } from './continuations.js';
import { ClassicDashStrategy } from '../playback/classicDash.js';
import type { PlaybackInfo, PlaybackStrategy } from '../playback/strategy.js';

/**
 * What this build can do about clients that need more than a plain request.
 * Both are `false` in Phase 1 — the ladder's `MWEB` / `WEB` entries are
 * therefore skipped with an actionable reason rather than attempted and left to
 * fail with a bare 403. Flipping either one on is the entire wiring cost of a
 * PO-token provider or of `SabrStrategy`.
 */
const CAPABILITIES: ClientCapabilities = { hasPoToken: false, hasSabr: false };

export interface InnertubeYouTubeSourceOptions {
  /** Persistent InnerTube cache directory (resolved by main under `userData`). */
  cacheDir: string;
  /**
   * URL rewriters for the loopback proxy.
   *
   * `image` / `caption` default to identity so the adapter is usable before the
   * proxy exists, but **once the proxy is wired all three must be supplied**:
   * youtubei.js pushes caption and storyboard URLs through the same
   * `url_transformer` as media, and an identity caption rewriter leaves
   * `www.youtube.com` URLs in a manifest the renderer's CSP will refuse to
   * fetch.
   */
  rewriters: MediaUrlRewriters;
  /** Playback strategy. Defaults to `ClassicDashStrategy` (the only Phase-1 impl). */
  strategy?: PlaybackStrategy;
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
  readonly #ladder = new Map<InnerTubeClient, LadderState>();
  readonly #strategy: PlaybackStrategy;
  /** Pagination state for the continuation-bearing Phase-2 feeds (search today). */
  readonly #continuations = new ContinuationStore();
  #lastClient: string | null = null;
  #lastExpiresAt: number | null = null;

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
    this.#strategy = opts.strategy ?? new ClassicDashStrategy();
  }

  async getVideo(params: { videoId: string }): Promise<Result<VideoDetail, LuneError>> {
    const videoId = normalizeId(params.videoId);
    if (videoId == null) return err(invalidId());

    return this.#guard(async (yt) => {
      const info = await yt.getInfo(videoId);
      const playErr = mapPlayabilityStatus(info.playability_status);
      const detail = mapVideoDetail(info as unknown as RawVideoInfo, this.#rewriteImage);
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

    // Walk the whole ladder, not just the attemptable subset, so every entry
    // ends up with a state — a skipped client must explain itself in the
    // diagnostics panel instead of silently reading "no error".
    const skipped: string[] = [];
    let lastError: LuneError | null = null;

    for (const entry of CLIENT_LADDER) {
      const skip = ladderSkipReason(entry, CAPABILITIES);
      if (skip !== null) {
        this.#ladder.set(entry.client, { ok: false, formats: 0, lastError: skip });
        skipped.push(skip);
        continue;
      }

      const attempt = await this.#guard((yt) =>
        this.#resolveStreams(yt, videoId, entry.client, params.prefs),
      );
      if (attempt.ok) return attempt;
      lastError = attempt.error;
      // A login/bot block is an IP-reputation problem, not a client problem:
      // the next client will hit the same wall. Stop and report it. Parser
      // breaks and per-client format gaps do keep walking.
      if (attempt.error.code === 'YT_LOGIN_REQUIRED') break;
    }

    if (lastError !== null) return err(lastError);
    return err(
      makeLuneError('PLAYBACK_FORBIDDEN', 'No usable InnerTube client is available.', {
        detail: 'ladder:none-attemptable',
        hint: skipped.join(' '),
      }),
    );
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

      const result = await this.#strategy.resolve(asPlaybackInfo(info), {
        client,
        prefs,
        rewriteMedia: this.#rewriteMedia,
        rewriteImage: this.#rewriteImage,
        rewriteCaption: this.#rewriteCaption,
        mapError: mapYoutubeError,
      });

      if (!result.ok) {
        state.lastError = result.error.message;
        // A parser break is the one failure a fresh player JS can fix, and
        // `#guard` is what knows how to do that. Throwing hands it back the
        // retry it already implements (`mapYoutubeError` passes a `LuneError`
        // through untouched, so nothing is lost if the retry also fails).
        if (result.error.code === 'YT_PARSE_CHANGED') throw result.error;
        return result;
      }

      state.ok = true;
      state.formats = result.value.video.length + result.value.audio.length;
      this.#lastClient = client;
      this.#lastExpiresAt = result.value.expiresAt;
      return result;
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
      const info = await yt.getInfo(videoId);
      return ok(this.#pageFromWatchNext(info));
    });
  }

  /**
   * The up-next rail is a single ~20-item page — no "load more" (decisions A13,
   * the F13 fix). `VideoInfo.getWatchNextContinuation()` replaces
   * `watch_next_feed` on `this` in place and returns `this`
   * (`youtube/VideoInfo.js:171-186`), so it is the one non-idempotent
   * continuation in the whole Phase-2 surface: a retry / back-nav /
   * StrictMode double-invoke would silently advance the cursor. Rather than
   * paginate it we drop pagination; `GetRelatedParams` and
   * `IpcRequests['yt:related']` carry no `continuation` field.
   */
  #pageFromWatchNext(info: unknown): Paged<VideoSummary> {
    const feed = (info as { watch_next_feed?: unknown }).watch_next_feed;
    return { items: mapFeedVideos(feed as never, this.#rewriteImage) };
  }

  /**
   * The PRD §8 diagnostics panel's data source: which client succeeded, how
   * many formats it produced, when those URLs expire, the last error (or the
   * skip reason) for every ladder entry, and the youtubei.js version — the four
   * things you need to tell "YouTube changed something" apart from "this
   * machine's IP is blocked".
   */
  async getDiagnostics(): Promise<Result<AdapterDiagnostics, LuneError>> {
    const ladder = CLIENT_LADDER.map((entry) => {
      const state = this.#ladder.get(entry.client);
      return {
        client: entry.client,
        ok: state?.ok ?? false,
        formats: state?.formats ?? 0,
        // Before the first call there is no state, so fall back to the static
        // reason this entry would be skipped for — non-null for every entry the
        // build cannot use, which is exactly what the panel needs to show.
        lastError: state?.lastError ?? ladderSkipReason(entry, CAPABILITIES),
      };
    });
    return ok({
      youtubeiVersion: youtubeiVersion(),
      lastClient: this.#lastClient,
      lastExpiresAt: this.#lastExpiresAt,
      ladder,
    });
  }

  // ---- Phase 2 ----

  async search(params: SearchParams): Promise<Result<SearchPage, LuneError>> {
    if (params.continuation !== undefined) {
      const stored = this.#continuations.get('search', params.continuation);
      if (stored === undefined) {
        return err(
          makeLuneError('INVALID_INPUT', 'This search refreshed. Reload to keep browsing.', {
            detail: 'continuation:search',
          }),
        );
      }
      return this.#guard(async () => {
        const next = await (stored as { getContinuation(): Promise<unknown> }).getContinuation();
        return ok(this.#toSearchPage(next));
      });
    }

    const query = typeof params.query === 'string' ? params.query.trim() : '';
    if (query.length === 0 || query.length > 256) {
      return err(makeLuneError('INVALID_INPUT', 'Search query must be 1–256 characters.'));
    }
    const filters = params.filters ? toInnertubeFilters(params.filters) : undefined;
    return this.#guard(async (yt) => {
      const search = await yt.search(query, filters);
      return ok(this.#toSearchPage(search));
    });
  }

  #toSearchPage(search: unknown): SearchPage {
    const { items, estimatedResults } = mapSearchPage(search as RawSearch, this.#rewriteImage);
    const hasMore = (search as { has_continuation?: unknown }).has_continuation === true;
    return hasMore
      ? { items, estimatedResults, continuation: this.#continuations.put('search', search) }
      : { items, estimatedResults };
  }

  async getSearchSuggestions(params: { query: string }): Promise<Result<string[], LuneError>> {
    const query = typeof params.query === 'string' ? params.query.trim() : '';
    if (query.length < 2) return ok([]);
    return this.#guard(async (yt) => ok(dedupeSuggestions(await yt.getSearchSuggestions(query))));
  }

  async getComments(_params: GetCommentsParams): Promise<Result<CommentPage, LuneError>> {
    return err(notImplemented('getComments'));
  }
  async getCommentReplies(
    _params: GetCommentRepliesParams,
  ): Promise<Result<Paged<Comment>, LuneError>> {
    return err(notImplemented('getCommentReplies'));
  }
  async getChannel(_params: GetChannelParams): Promise<Result<ChannelPage, LuneError>> {
    return err(notImplemented('getChannel'));
  }
  async getPlaylist(_params: GetPlaylistParams): Promise<Result<PlaylistDetail, LuneError>> {
    return err(notImplemented('getPlaylist'));
  }
  /**
   * Local parse first (`parseYouTubeUrl`, offline, host-allow-listed); the
   * network (`yt.resolveURL`) is only reached for a `/@handle` / `/c/` /
   * `/user/` path on a YouTube host — the allow-list therefore runs **before**
   * any upstream call, so a foreign URL is never forwarded (plan P2-3).
   */
  async resolveUrl(params: { url: string }): Promise<Result<NavTarget, LuneError>> {
    const raw = typeof params.url === 'string' ? params.url.trim() : '';
    const local = parseYouTubeUrl(raw);
    if (local !== null) return ok(local);
    return this.#guard(async (yt) => ok(navTargetFromEndpoint(await yt.resolveURL(raw), raw)));
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

/** Trim, drop empties / over-long / duplicates, cap at 12 (plan P2-3). */
function dedupeSuggestions(raw: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of Array.isArray(raw) ? raw : []) {
    if (typeof value !== 'string') continue;
    const s = value.trim();
    if (s.length === 0 || s.length > 100 || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= 12) break;
  }
  return out;
}

/**
 * A youtubei.js `NavigationEndpoint` (from `yt.resolveURL`) → `NavTarget`. Reads
 * `payload.{videoId,playlistId,browseId}` (P2-F8) and re-validates each id before
 * it leaves the adapter.
 */
function navTargetFromEndpoint(endpoint: unknown, url: string): NavTarget {
  const payload =
    (endpoint as { payload?: Record<string, unknown> } | null | undefined)?.payload ?? {};
  const videoId = payload['videoId'];
  const playlistId = payload['playlistId'];
  const browseId = payload['browseId'];
  if (typeof videoId === 'string' && isValidVideoId(videoId)) return { kind: 'video', videoId };
  if (typeof playlistId === 'string' && isValidPlaylistId(playlistId)) {
    return { kind: 'playlist', playlistId };
  }
  if (typeof browseId === 'string' && isValidChannelId(browseId)) {
    return { kind: 'channel', channelId: browseId };
  }
  return { kind: 'unknown', url };
}

/**
 * The one cast at the playback seam.
 *
 * `packages/youtube/src/playback/**` may not import youtubei.js (ESLint), so
 * `PlaybackInfo` is a structural view built from the mappers' `unknown`-typed
 * raw shapes. youtubei.js' concrete `VideoInfo` matches it at runtime but is
 * not assignable to it under `exactOptionalPropertyTypes` (its class-typed
 * `storyboards` / `captions` are narrower than the loose fixture-friendly
 * shapes the mappers accept). Confining the cast here keeps it visible and
 * keeps every other file honest.
 */
function asPlaybackInfo(info: unknown): PlaybackInfo {
  return info as PlaybackInfo;
}
