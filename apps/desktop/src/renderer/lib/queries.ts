import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  AdapterDiagnostics,
  Paged,
  StreamManifest,
  StreamPrefs,
  VideoDetail,
  VideoSummary,
} from '@lunetube/shared';
import { invoke, IpcError } from './ipc.js';

/**
 * The `yt:*` query hooks (plan P1-4). Query keys are namespaced under `'yt'`.
 * `staleTime` is per-resource — stream URLs expire fast, video metadata does
 * not. `retry` only fires for a `LuneError` that says it is retryable, at most
 * twice.
 */

const retry = (failureCount: number, error: unknown): boolean =>
  error instanceof IpcError && error.retryable && failureCount < 2;

const MINUTE = 60_000;

export const ytKeys = {
  video: (videoId: string) => ['yt', 'video', videoId] as const,
  streams: (videoId: string, prefs: StreamPrefs) => ['yt', 'streams', videoId, prefs] as const,
  related: (videoId: string) => ['yt', 'related', videoId] as const,
  diagnostics: () => ['yt', 'diagnostics'] as const,
};

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
