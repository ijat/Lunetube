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
 * Phase 1 implements `getVideo`, `getStreams`, `getRelated` and `getDiagnostics`.
 * The remaining seven methods return a `NOT_IMPLEMENTED` `LuneError` until
 * Phase 2 fills them in (search / channel / comments / playlist / resolveUrl).
 */
import type {
  AdapterDiagnostics,
  ChannelDetail,
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
 * (`apps/desktop/src/main/proxy`, wired in P1-3/P1-4). `packages/youtube` never
 * imports the proxy or `electron`; it only receives these callbacks.
 *
 * `media` is required (googlevideo segment URLs → `/media`). `image`
 * (thumbnails / storyboards → `/img`) and `caption` (`timedtext` → `/caption`)
 * default to identity so the adapter is usable in tests and before the proxy
 * exists.
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
  continuation?: string;
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
  /** Opaque handle minted by `getComments` for a thread with replies. */
  handle: string;
  continuation: string;
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

  // ---- Phase 2 (NOT_IMPLEMENTED until then) ----
  search(params: SearchParams): Promise<Result<SearchPage, LuneError>>;
  getSearchSuggestions(params: { query: string }): Promise<Result<string[], LuneError>>;
  getComments(params: GetCommentsParams): Promise<Result<CommentPage, LuneError>>;
  getCommentReplies(params: GetCommentRepliesParams): Promise<Result<Paged<Comment>, LuneError>>;
  getChannel(
    params: GetChannelParams,
  ): Promise<Result<ChannelDetail | Paged<VideoSummary>, LuneError>>;
  getPlaylist(params: GetPlaylistParams): Promise<Result<PlaylistDetail, LuneError>>;
  resolveUrl(params: { url: string }): Promise<Result<NavTarget, LuneError>>;
}
