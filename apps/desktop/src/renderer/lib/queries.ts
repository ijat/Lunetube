import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type QueryClient,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  AdapterDiagnostics,
  ChannelPage,
  ChannelTab,
  Comment,
  CommentPage,
  CommentSort,
  NavTarget,
  Paged,
  PlaylistDetail,
  SearchFilters,
  SearchPage,
  StreamManifest,
  StreamPrefs,
  VideoDetail,
  VideoSummary,
} from '@lunetube/shared';
import { invoke, IpcError } from './ipc.js';

/**
 * The `yt:*` query hooks (plan P1-4, extended P2-6). Query keys are
 * namespaced under `'yt'`. `staleTime` is per-resource — stream URLs expire
 * fast, video metadata does not. `retry` only fires for a `LuneError` that
 * says it is retryable, at most twice.
 */

const retry = (failureCount: number, error: unknown): boolean =>
  error instanceof IpcError && error.retryable && failureCount < 2;

const MINUTE = 60_000;

export const ytKeys = {
  video: (videoId: string) => ['yt', 'video', videoId] as const,
  streams: (videoId: string, prefs: StreamPrefs) => ['yt', 'streams', videoId, prefs] as const,
  related: (videoId: string) => ['yt', 'related', videoId] as const,
  diagnostics: () => ['yt', 'diagnostics'] as const,
  search: (query: string, filters?: SearchFilters) => ['yt', 'search', query, filters] as const,
  suggestions: (query: string) => ['yt', 'suggestions', query] as const,
  comments: (videoId: string, sort: CommentSort) => ['yt', 'comments', videoId, sort] as const,
  commentReplies: (handle: string) => ['yt', 'commentReplies', handle] as const,
  channel: (channelId: string, tab: ChannelTab) => ['yt', 'channel', channelId, tab] as const,
  playlist: (playlistId: string) => ['yt', 'playlist', playlistId] as const,
};

/**
 * `getNextPageParam` for every Phase-2 paged resource: `SearchPage`,
 * `CommentPage`, `Paged<Comment>`, `ChannelPage` and `PlaylistDetail` all
 * carry the same optional `continuation?: string` field, so one helper covers
 * all five `useInfiniteQuery` hooks below. Exported so `queries.test.ts` can
 * pin the with/without-`continuation` behaviour directly.
 */
export function getNextPageParam(lastPage: { continuation?: string }): string | undefined {
  return lastPage.continuation ?? undefined;
}

/**
 * Appends `continuation` to a base request object only when it is defined —
 * `exactOptionalPropertyTypes` forbids setting an optional IPC field to
 * `undefined` explicitly, so the key must be omitted rather than nulled out.
 */
function withContinuation<T extends Record<string, unknown>>(
  base: T,
  continuation: string | undefined,
): T & { continuation?: string } {
  return continuation === undefined ? base : { ...base, continuation };
}

export function useVideo(videoId: string): UseQueryResult<VideoDetail, IpcError> {
  return useQuery<VideoDetail, IpcError>({
    queryKey: ytKeys.video(videoId),
    queryFn: () => invoke('yt:video', { videoId }),
    staleTime: 5 * MINUTE,
    retry,
    enabled: videoId.length > 0,
  });
}

export function useStreams(
  videoId: string,
  prefs: StreamPrefs,
): UseQueryResult<StreamManifest, IpcError> {
  return useQuery<StreamManifest, IpcError>({
    queryKey: ytKeys.streams(videoId, prefs),
    queryFn: () => invoke('yt:streams', { videoId, prefs }),
    staleTime: 60_000,
    retry,
    enabled: videoId.length > 0,
  });
}

export function useRelated(videoId: string): UseQueryResult<Paged<VideoSummary>, IpcError> {
  return useQuery<Paged<VideoSummary>, IpcError>({
    queryKey: ytKeys.related(videoId),
    queryFn: () => invoke('yt:related', { videoId }),
    staleTime: 5 * MINUTE,
    retry,
    enabled: videoId.length > 0,
  });
}

/**
 * Not yet consumed by a route: this is the data source for the Phase-2
 * diagnostics panel (PRD §8 — "which parser version / client / expiry", to tell
 * "YouTube changed something" apart from "this IP is blocked"). Kept here because
 * `yt:diagnostics` is a registered Phase-1 channel and the panel is the next
 * consumer.
 */
export function useDiagnostics(): UseQueryResult<AdapterDiagnostics, IpcError> {
  return useQuery<AdapterDiagnostics, IpcError>({
    queryKey: ytKeys.diagnostics(),
    queryFn: () => invoke('yt:diagnostics', {}),
    staleTime: 0,
    retry,
  });
}

// ---- Phase 2 ----

export function useSearch(
  query: string,
  filters?: SearchFilters,
): UseInfiniteQueryResult<InfiniteData<SearchPage>, IpcError> {
  return useInfiniteQuery<
    SearchPage,
    IpcError,
    InfiniteData<SearchPage>,
    ReturnType<typeof ytKeys.search>,
    string | undefined
  >({
    queryKey: ytKeys.search(query, filters),
    queryFn: ({ pageParam }) =>
      invoke(
        'yt:search',
        withContinuation(filters === undefined ? { query } : { query, filters }, pageParam),
      ),
    initialPageParam: undefined,
    getNextPageParam: (last) => getNextPageParam(last),
    staleTime: 2 * MINUTE,
    retry,
    enabled: query.trim().length > 0,
  });
}

export function useSearchSuggestions(query: string): UseQueryResult<string[], IpcError> {
  return useQuery<string[], IpcError>({
    queryKey: ytKeys.suggestions(query),
    queryFn: () => invoke('yt:searchSuggestions', { query }),
    staleTime: 5 * MINUTE,
    retry,
    enabled: query.trim().length >= 2,
  });
}

export function useComments(
  videoId: string,
  sort: CommentSort,
): UseInfiniteQueryResult<InfiniteData<CommentPage>, IpcError> {
  return useInfiniteQuery<
    CommentPage,
    IpcError,
    InfiniteData<CommentPage>,
    ReturnType<typeof ytKeys.comments>,
    string | undefined
  >({
    queryKey: ytKeys.comments(videoId, sort),
    queryFn: ({ pageParam }) =>
      invoke('yt:comments', withContinuation({ videoId, sort }, pageParam)),
    initialPageParam: undefined,
    getNextPageParam: (last) => getNextPageParam(last),
    staleTime: MINUTE,
    retry,
    enabled: videoId.length > 0,
  });
}

export function useCommentReplies(
  handle: string,
  enabled: boolean,
): UseInfiniteQueryResult<InfiniteData<Paged<Comment>>, IpcError> {
  return useInfiniteQuery<
    Paged<Comment>,
    IpcError,
    InfiniteData<Paged<Comment>>,
    ReturnType<typeof ytKeys.commentReplies>,
    string | undefined
  >({
    queryKey: ytKeys.commentReplies(handle),
    queryFn: ({ pageParam }) => invoke('yt:commentReplies', { handle: pageParam ?? handle }),
    initialPageParam: undefined,
    getNextPageParam: (last) => getNextPageParam(last),
    staleTime: MINUTE,
    retry,
    enabled: enabled && handle.length > 0,
  });
}

export function useChannel(
  channelId: string,
  tab: ChannelTab,
): UseInfiniteQueryResult<InfiniteData<ChannelPage>, IpcError> {
  return useInfiniteQuery<
    ChannelPage,
    IpcError,
    InfiniteData<ChannelPage>,
    ReturnType<typeof ytKeys.channel>,
    string | undefined
  >({
    queryKey: ytKeys.channel(channelId, tab),
    queryFn: ({ pageParam }) =>
      invoke('yt:channel', withContinuation({ channelId, tab }, pageParam)),
    initialPageParam: undefined,
    getNextPageParam: (last) => getNextPageParam(last),
    staleTime: 5 * MINUTE,
    retry,
    enabled: channelId.length > 0,
  });
}

export function usePlaylist(
  playlistId: string,
): UseInfiniteQueryResult<InfiniteData<PlaylistDetail>, IpcError> {
  return useInfiniteQuery<
    PlaylistDetail,
    IpcError,
    InfiniteData<PlaylistDetail>,
    ReturnType<typeof ytKeys.playlist>,
    string | undefined
  >({
    queryKey: ytKeys.playlist(playlistId),
    queryFn: ({ pageParam }) => invoke('yt:playlist', withContinuation({ playlistId }, pageParam)),
    initialPageParam: undefined,
    getNextPageParam: (last) => getNextPageParam(last),
    staleTime: 5 * MINUTE,
    retry,
    enabled: playlistId.length > 0,
  });
}

/**
 * `resolveUrl` is imperative, not a hook (plan P2-6) — it runs once on
 * search-bar submit, not on render. `queryClient.fetchQuery` still dedupes
 * concurrent calls for the same URL and caches the result briefly.
 */
export function resolveUrlOnce(queryClient: QueryClient, url: string): Promise<NavTarget> {
  return queryClient.fetchQuery<NavTarget>({
    queryKey: ['yt', 'resolveUrl', url],
    queryFn: () => invoke('yt:resolveUrl', { url }),
    staleTime: 30_000,
  });
}

/**
 * A stale/expired/forged continuation handle always comes back as
 * `INVALID_INPUT` with a `detail` prefixed `continuation:<kind>` (verified
 * across every P2-2..P2-5 adapter path: `search`, `comments`,
 * `replies-first`, `replies-more`, `channel`, `playlist`). List surfaces use
 * this to render "This list refreshed — reload" wired to `refetch()` instead
 * of a generic error banner.
 */
export function isStaleContinuation(error: unknown): boolean {
  return (
    error instanceof IpcError &&
    error.code === 'INVALID_INPUT' &&
    (error.detail?.startsWith('continuation:') ?? false)
  );
}
