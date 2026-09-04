/**
 * `YouTubeSource` backed by youtubei.js (InnerTube).
 *
 * This file, `session.ts` and `errors.ts` are the only three allowed to import
 * `youtubei.js`. Everything it returns is a plain `@lunetube/shared` DTO.
 *
 * Phase 1 scope: `getVideo`, `getStreams`, `getRelated`, `getDiagnostics`.
 * Phase 2 adds `search`, `getSearchSuggestions`, `resolveUrl` (P2-3),
 * `getChannel`, `getPlaylist` (P2-4) and `getComments` / `getCommentReplies`
 * (P2-5) — the whole `YouTubeSource` contract is now implemented.
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
  type ChannelAbout,
  type ChannelPage,
  type ChannelTab,
  type Comment,
  type CommentPage,
  type CommentSort,
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
import { mapPlayabilityStatus, mapYoutubeError } from './errors.js';
import { InnertubeSession, youtubeiVersion, type InnertubeSessionOptions } from './session.js';
import { mapFeedVideos, mapVideoDetail, type RawVideoInfo } from './map/video.js';
import { mapSearchPage, toInnertubeFilters, type RawSearch } from './map/search.js';
import { isValidChannelId, isValidPlaylistId, isValidVideoId, parseYouTubeUrl } from './map/url.js';
import { mapAbout, mapChannelDetail, mapChannelTabContent } from './map/channel.js';
import {
  mapCommentThreads,
  mapCommentsTotalText,
  mapLoadedReplies,
  type RawCommentsHeader,
} from './map/comments.js';
import { mapPlaylistDetail } from './map/playlist.js';
import { textToString, type MaybeText } from './map/util.js';
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
  /**
   * Pagination state for every continuation-bearing Phase-2 feed: `'search'`,
   * `'channel'`, `'playlist'`, `'comments'`, and the two reply kinds
   * `'replies-first'` / `'replies-more'`. The store is kind-namespaced and
   * identity-deduped, which is what lets one `CommentThread` object carry two
   * distinct handles — one per call it must be reached through — without either
   * handle ever being able to trigger the other's call.
   */
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

  /**
   * First page: `yt.getComments(videoId, 'TOP_COMMENTS'|'NEWEST_FIRST')`.
   *
   * **`Comments.applySort` is never called** (P2-F6 #2): it throws whenever the
   * header or the sort button is missing (`Comments.js:39-50`). The sort is
   * baked into the protobuf continuation token at request time
   * (`Innertube.js:224-244`), so every continuation *inherits* it and the handle
   * needs no sort tag of its own — a `comments:` handle minted for a "newest"
   * page keeps paging newest even though `params.sort` is not consulted again.
   *
   * Continuation: `Comments.getContinuation()` returns a **new** `Comments`
   * (`Comments.js:73-85` — it copies the page so the header survives), so page 2
   * is a fresh object and page 1's handle stays valid and unchanged.
   */
  async getComments(params: GetCommentsParams): Promise<Result<CommentPage, LuneError>> {
    if (params.continuation !== undefined) {
      const stored = this.#continuations.get('comments', params.continuation);
      if (stored === undefined) {
        return err(
          makeLuneError('INVALID_INPUT', 'These comments refreshed. Reload to keep reading.', {
            detail: 'continuation:comments',
          }),
        );
      }
      return this.#guard(async () => {
        const next = await (stored as { getContinuation(): Promise<unknown> }).getContinuation();
        return ok(this.#toCommentPage(next));
      });
    }

    const videoId = normalizeId(params.videoId);
    if (videoId == null) return err(invalidId());
    const sortBy: InnertubeCommentSort = innertubeCommentSort(params.sort);
    return this.#guard(async (yt) =>
      ok(this.#toCommentPage(await yt.getComments(videoId, sortBy))),
    );
  }

  #toCommentPage(comments: unknown): CommentPage {
    const raw = comments as { header?: RawCommentsHeader | null; contents?: unknown };
    const page: CommentPage = {
      header: { totalText: mapCommentsTotalText(raw.header) },
      threads: mapCommentThreads(raw.contents, this.#rewriteImage, (thread) =>
        this.#continuations.put('replies-first', thread),
      ),
    };
    // `Comments.has_continuation` is a plain `!!this.#continuation` getter
    // (`Comments.js:86-88`) — unlike `CommentThread`'s, it never throws.
    if ((raw as { has_continuation?: unknown }).has_continuation === true) {
      page.continuation = this.#continuations.put('comments', comments);
    }
    return page;
  }

  /**
   * The reply three-state machine (A17). The handle's **kind prefix** selects the
   * call, because reply page 1 and reply page 2 of the same thread are reached
   * through two different methods on the same object:
   *
   *  - `replies-first:` → `CommentThread.getReplies()`. Returns `this`
   *    (`CommentThread.js:65`) and is **replay-safe**: when the thread is
   *    prepopulated it returns immediately with the replies the `Comments`
   *    constructor already attached (no network at all); otherwise it refetches
   *    the *same* page-1 endpoint and `#processList` reassigns
   *    `this.replies = observe([])` from scratch (`CommentThread.js:97-111`).
   *    Either way a second call yields the same page — which is the property the
   *    whole design rests on, since a retry, a back-nav or a StrictMode
   *    double-invoke must not advance the cursor.
   *  - `replies-more:` → `getContinuation()`. On a `CommentThread` this returns a
   *    **new** `CommentsContinuation` without mutating `this`
   *    (`CommentThread.js:70-82`); on a `CommentsContinuation` it returns another
   *    new `CommentsContinuation` (`CommentsContinuation.js:38-46`). So the
   *    `replies-more:` branch is uniform over both, and each page is a distinct
   *    object with its own handle.
   *  - anything else (a `comments:` handle, a `search:` handle, junk) →
   *    `INVALID_INPUT`. The store's kind check would reject it anyway; the
   *    explicit prefix dispatch is what makes *which call to make* unambiguous.
   */
  async getCommentReplies(
    params: GetCommentRepliesParams,
  ): Promise<Result<Paged<Comment>, LuneError>> {
    const handle = typeof params.handle === 'string' ? params.handle : '';

    if (handle.startsWith('replies-first:')) {
      const stored = this.#continuations.get('replies-first', handle);
      if (stored === undefined) return err(staleReplies('replies-first'));
      return this.#guard(async () => {
        const returned = await (stored as { getReplies(): Promise<unknown> }).getReplies();
        // v18.0.0 returns `this`; prefer whatever it hands back anyway so a
        // future version that returns a fresh object cannot leave us mapping a
        // stale one.
        return ok(this.#repliesPage(returned ?? stored));
      });
    }

    if (handle.startsWith('replies-more:')) {
      const stored = this.#continuations.get('replies-more', handle);
      if (stored === undefined) return err(staleReplies('replies-more'));
      return this.#guard(async () => {
        const next = await (stored as { getContinuation(): Promise<unknown> }).getContinuation();
        return ok(this.#repliesPage(next));
      });
    }

    return err(
      makeLuneError('INVALID_INPUT', 'Not a comment-replies handle.', {
        detail: 'continuation:replies-kind',
        hint: REPLIES_HINT,
      }),
    );
  }

  /**
   * A loaded reply page (`CommentThread` after `getReplies()`, or a
   * `CommentsContinuation`) → `Paged<Comment>`.
   *
   * This is the **only** place `has_continuation` is read for a `CommentThread`,
   * and it is reached only after that thread's `getReplies()` has resolved. It is
   * still guarded: `getReplies()` returns without assigning `this.replies` when
   * the response carries no `AppendContinuationItemsAction`
   * (`CommentThread.js:61-63`), and the getter throws in exactly that case
   * (`CommentThread.js:31-35`). "Replies never loaded" means "no page we could
   * reach" — `getContinuation()` refuses for the same reason — so it degrades to
   * a final page rather than an error.
   */
  #repliesPage(node: unknown): Paged<Comment> {
    const page: Paged<Comment> = { items: mapLoadedReplies(node, this.#rewriteImage) };
    if (hasMoreReplies(node)) page.continuation = this.#continuations.put('replies-more', node);
    return page;
  }

  /**
   * First page: `@handle` channel ids are resolved to a browse id via
   * `yt.resolveURL` first (P2-F8 — `Innertube.getChannel` only accepts a
   * browse id). The About tab short-circuits before any tab getter runs — it
   * has no continuation and needs `getAbout()`, not `get<Tab>()`. Every other
   * tab calls the matching `get<Tab>()` getter, each of which returns a *new*
   * `Channel` (P2-F2).
   *
   * Continuation: the stored object is always a `Channel` or a
   * `ChannelListContinuation` (P2-F2); both expose `getContinuation()` →
   * a new `ChannelListContinuation`, which carries no header of its own.
   */
  async getChannel(params: GetChannelParams): Promise<Result<ChannelPage, LuneError>> {
    if (params.continuation !== undefined) {
      const stored = this.#continuations.get('channel', params.continuation);
      if (stored === undefined) {
        return err(
          makeLuneError('INVALID_INPUT', 'This channel list refreshed. Reload to keep browsing.', {
            detail: 'continuation:channel',
          }),
        );
      }
      return this.#guard(async () => {
        const next = await (stored as { getContinuation(): Promise<unknown> }).getContinuation();
        return ok(this.#channelListPage(params.tab, next, undefined));
      });
    }

    const channelId = normalizeChannelId(params.channelId);
    if (channelId == null) {
      return err(makeLuneError('INVALID_INPUT', 'Not a valid channel id or handle.'));
    }

    const tab = params.tab;
    return this.#guard(async (yt) => {
      const browseId = channelId.startsWith('@')
        ? await this.#resolveHandle(yt, channelId)
        : channelId;
      if (browseId == null) {
        return err(
          makeLuneError('YT_UNAVAILABLE', 'This channel could not be found.', {
            detail: 'resolve:@handle',
          }),
        );
      }
      const ch = await yt.getChannel(browseId);
      const detail = mapChannelDetail(ch, this.#rewriteImage);

      if (tab === 'about') {
        return ok({
          channel: detail,
          tab,
          content: { kind: 'about', about: await this.#resolveAbout(ch) },
        });
      }

      const untyped = ch as unknown as Record<string, unknown>;
      if (untyped[TAB_HAS_FLAG[tab]] !== true) {
        return err(
          makeLuneError('YT_UNAVAILABLE', `This channel has no "${tab}" tab.`, {
            detail: `tab:${tab}`,
          }),
        );
      }
      const getTab = untyped[TAB_GETTER[tab]];
      if (typeof getTab !== 'function') {
        return err(
          makeLuneError('YT_PARSE_CHANGED', `Channel has no "${TAB_GETTER[tab]}" method.`, {
            detail: `tab:${tab}`,
          }),
        );
      }
      const feed = await (getTab as () => Promise<unknown>).call(ch);
      return ok(this.#channelListPage(tab, feed, detail));
    });
  }

  #channelListPage(
    tab: ChannelTab,
    feed: unknown,
    detail: ReturnType<typeof mapChannelDetail> | undefined,
  ): ChannelPage {
    const content = mapChannelTabContent(tab, feed, this.#rewriteImage);
    const page: ChannelPage =
      detail !== undefined ? { channel: detail, tab, content } : { tab, content };
    if ((feed as { has_continuation?: unknown }).has_continuation === true) {
      page.continuation = this.#continuations.put('channel', feed);
    }
    return page;
  }

  /**
   * `@handle` → browse id via `yt.resolveURL` (P2-F8). `null` when the handle
   * cannot be resolved to a valid channel id.
   */
  async #resolveHandle(yt: Innertube, handle: string): Promise<string | null> {
    const endpoint = await yt.resolveURL(`https://www.youtube.com/${handle}`);
    const browseId = (endpoint as { payload?: { browseId?: unknown } } | null)?.payload?.browseId;
    return typeof browseId === 'string' && isValidChannelId(browseId) ? browseId : null;
  }

  /**
   * `Channel.getAbout()` returns one of two shapes (`ChannelAboutFullMetadata`
   * or `AboutChannel`) or throws `'About not found'` when the channel has no
   * about surface at all (P2-F6). About is a secondary tab, so any failure —
   * not just that specific message — degrades to the channel metadata's
   * description rather than failing the whole page.
   */
  async #resolveAbout(ch: unknown): Promise<ChannelAbout> {
    const fallback = textToString(
      (ch as { metadata?: { description?: unknown } } | null)?.metadata?.description as MaybeText,
    );
    try {
      const raw = await (ch as { getAbout(): Promise<unknown> }).getAbout();
      return mapAbout(raw, fallback);
    } catch {
      return mapAbout(null, fallback);
    }
  }

  /**
   * First page: `yt.getPlaylist(id)` (no `VL` prefixing — youtubei.js already
   * does that, P2-F8). The `Playlist` constructor throws a specific message on
   * the last page (`'Got empty continuation response...'`, P2-F6 #3) — that is
   * a normal end-of-list condition, not an error, so it is caught here and
   * turned into an empty `ok` page instead of reaching `#guard`'s generic
   * error mapping.
   */
  async getPlaylist(params: GetPlaylistParams): Promise<Result<PlaylistDetail, LuneError>> {
    const playlistId = normalizePlaylistId(params.playlistId);
    if (playlistId == null) return err(makeLuneError('INVALID_INPUT', 'Not a valid playlist id.'));

    if (params.continuation !== undefined) {
      const stored = this.#continuations.get('playlist', params.continuation);
      if (stored === undefined) {
        return err(
          makeLuneError('INVALID_INPUT', 'This playlist refreshed. Reload to keep browsing.', {
            detail: 'continuation:playlist',
          }),
        );
      }
      return this.#guard(() =>
        this.#nextPlaylistPage(
          () => (stored as { getContinuation(): Promise<unknown> }).getContinuation(),
          playlistId,
        ),
      );
    }

    return this.#guard((yt) =>
      this.#nextPlaylistPage(() => yt.getPlaylist(playlistId), playlistId),
    );
  }

  async #nextPlaylistPage(
    fetch: () => Promise<unknown>,
    playlistId: string,
  ): Promise<Result<PlaylistDetail, LuneError>> {
    let pl: unknown;
    try {
      pl = await fetch();
    } catch (e) {
      if (isEndOfPlaylist(e)) {
        return ok({
          id: playlistId,
          title: '',
          thumbnailUrl: null,
          videoCount: null,
          description: '',
          author: null,
          lastUpdatedText: null,
          items: [],
        });
      }
      throw e;
    }
    const detail = mapPlaylistDetail(pl, playlistId, this.#rewriteImage);
    if ((pl as { has_continuation?: unknown }).has_continuation === true) {
      detail.continuation = this.#continuations.put('playlist', pl);
    }
    return ok(detail);
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

/** A `UC…` id, an `@handle`, or an unqualified vanity id (plan P2-4), ≤ 64 chars. */
function normalizeChannelId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return null;
  return /^(UC[\w-]{22}|@[\w.-]{3,30}|[\w-]{2,64})$/.test(trimmed) ? trimmed : null;
}

function normalizePlaylistId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return isValidPlaylistId(trimmed) ? trimmed : null;
}

/** The five non-about `ChannelTab`s → the `Channel.has_*` boolean that guards them. */
const TAB_HAS_FLAG: Record<Exclude<ChannelTab, 'about'>, string> = {
  videos: 'has_videos',
  shorts: 'has_shorts',
  playlists: 'has_playlists',
  live: 'has_live_streams',
  podcasts: 'has_podcasts',
};

/** The five non-about `ChannelTab`s → the `Channel` getter that fetches them (P2-4). */
const TAB_GETTER: Record<Exclude<ChannelTab, 'about'>, string> = {
  videos: 'getVideos',
  shorts: 'getShorts',
  playlists: 'getPlaylists',
  live: 'getLiveStreams',
  podcasts: 'getPodcasts',
};

/** youtubei.js' own sort argument for `Innertube.getComments` (`Innertube.js:220-223`). */
type InnertubeCommentSort = 'TOP_COMMENTS' | 'NEWEST_FIRST';

function innertubeCommentSort(sort: CommentSort): InnertubeCommentSort {
  return sort === 'newest' ? 'NEWEST_FIRST' : 'TOP_COMMENTS';
}

const REPLIES_HINT = 'Reload the comments to keep reading this thread.';

/** A handle that no longer resolves — expired TTL, LRU-evicted, or never minted. */
function staleReplies(kind: 'replies-first' | 'replies-more'): LuneError {
  return makeLuneError('INVALID_INPUT', 'This comment thread refreshed.', {
    detail: `continuation:${kind}`,
    hint: REPLIES_HINT,
  });
}

/**
 * `has_continuation` on a **loaded** reply page.
 *
 * `CommentsContinuation.has_continuation` is a safe `!!` getter
 * (`CommentsContinuation.js:32-34`). `CommentThread.has_continuation` throws
 * unless `this.replies` was assigned (`CommentThread.js:31-35`), which
 * `getReplies()` does not guarantee — see `#repliesPage`. Callers must have run
 * the page-1 fetch first; the try/catch covers the residual case and reports "no
 * further page", never an error.
 */
function hasMoreReplies(node: unknown): boolean {
  try {
    return (node as { has_continuation?: unknown } | null)?.has_continuation === true;
  } catch {
    return false;
  }
}

/**
 * `Playlist`'s constructor throws this exact message on the last page
 * (`youtube/Playlist.js:36-38`) — a normal end-of-list condition surfaced as a
 * throw (P2-F6 #3), not a real error.
 */
function isEndOfPlaylist(e: unknown): boolean {
  return e instanceof Error && /empty continuation response/i.test(e.message);
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
