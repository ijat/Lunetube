/**
 * The single adapter seam (PRD §2). Everything the rest of the app knows about
 * "getting things from YouTube" is this interface, expressed purely in
 * `@lunetube/shared` DTOs and `Result<T, LuneError>`.
 *
 * **No `youtubei.js` import may appear in this file** — ESLint enforces it
 * (`no-restricted-imports`, scoped so only `src/innertube/**` is exempt). Any
 * InnerTube-shaped code lives under `src/innertube/`. A future Piped/Invidious
 * backend implements `YouTubeSource` in a sibling directory and a factory picks
 * one.
 *
 * Phase 1 implemented `getVideo`, `getStreams`, `getRelated` and
 * `getDiagnostics`. Phase 2 added `search`, `getSearchSuggestions`,
 * `getComments`, `getCommentReplies`, `getChannel`, `getPlaylist` and
 * `resolveUrl`; every method is now implemented by both sources.
 */
import type {
  AdapterDiagnostics,
  ChannelPage,
  ChannelTab,
  Comment,
  CommentPage,
  CommentSort,
  LuneError,
  NavTarget,
  Paged,
  PlaylistDetail,
  Result,
  SearchFilters,
  SearchPage,
  StreamManifest,
  StreamPrefs,
  VideoDetail,
  VideoSummary,
} from '@lunetube/shared';

/**
 * Rewrites an upstream URL to the loopback media proxy
 * (`apps/desktop/src/main/proxy`, wired in P1-4). `packages/youtube` never
 * imports the proxy or `electron`; it only receives these callbacks.
 *
 * `media` is required (googlevideo segment URLs → `/media`). `image`
 * (thumbnails / storyboards → `/img`) and `caption` (`timedtext` → `/caption`)
 * default to identity so the adapter is usable in tests and before the proxy
 * exists.
 *
 * **Whoever wires the real proxy must supply all three.** A generated DASH
 * manifest carries caption tracks alongside media, and the renderer's CSP only
 * permits `http://127.0.0.1:*`; leaving `caption` as identity produces a
 * manifest whose text tracks the renderer is not allowed to fetch. See
 * `src/playback/classicDash.ts` for how the three routes are demultiplexed.
 */
export interface MediaUrlRewriters {
  media: (url: URL) => URL;
  image?: (url: URL) => URL;
  caption?: (url: URL) => URL;
}

/** Identity rewriter — the default when a proxy route is not wired yet. */
export const identityRewriter = (url: URL): URL => url;

export interface GetRelatedParams {
  videoId: string;
}

export interface SearchParams {
  query: string;
  filters?: SearchFilters;
  continuation?: string;
}

export interface GetCommentsParams {
  videoId: string;
  sort: CommentSort;
  continuation?: string;
}

export interface GetCommentRepliesParams {
  /**
   * A single opaque handle (A17). It encodes both the target `CommentThread`
   * *and* the action to take on it — the same object needs `getReplies()` for
   * reply page 1 and `getContinuation()` for page 2 (plan P2-F2), so the handle
   * carries a kind prefix (`replies-first:` / `replies-more:`).
   */
  handle: string;
}

export interface GetChannelParams {
  channelId: string;
  tab: ChannelTab;
  continuation?: string;
}

export interface GetPlaylistParams {
  playlistId: string;
  continuation?: string;
}

/**
 * Method parameters are single objects that mirror the `yt:*` IPC payloads
 * (`packages/shared/src/ipc.ts`) so `apps/desktop/src/main/ipc/youtube.ts` (P1-4)
 * can forward them unchanged.
 */
export interface YouTubeSource {
  getVideo(params: { videoId: string }): Promise<Result<VideoDetail, LuneError>>;
  getStreams(params: {
    videoId: string;
    prefs: StreamPrefs;
  }): Promise<Result<StreamManifest, LuneError>>;
  getRelated(params: GetRelatedParams): Promise<Result<Paged<VideoSummary>, LuneError>>;
  getDiagnostics(): Promise<Result<AdapterDiagnostics, LuneError>>;

  // ---- Phase 2 ----
  search(params: SearchParams): Promise<Result<SearchPage, LuneError>>;
  getSearchSuggestions(params: { query: string }): Promise<Result<string[], LuneError>>;
  getComments(params: GetCommentsParams): Promise<Result<CommentPage, LuneError>>;
  getCommentReplies(params: GetCommentRepliesParams): Promise<Result<Paged<Comment>, LuneError>>;
  getChannel(params: GetChannelParams): Promise<Result<ChannelPage, LuneError>>;
  getPlaylist(params: GetPlaylistParams): Promise<Result<PlaylistDetail, LuneError>>;
  resolveUrl(params: { url: string }): Promise<Result<NavTarget, LuneError>>;
}
