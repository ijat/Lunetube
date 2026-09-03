import { QueryClient } from '@tanstack/react-query';

/**
 * The renderer's single `QueryClient` (plan "State management": TanStack Query
 * v5 owns everything that comes over `yt:*`).
 *
 * Per-resource `staleTime` and the `retry` predicate live on the individual
 * hooks in `queries.ts`; the defaults here are the conservative baseline —
 * no refetch-on-focus (this is a desktop app, not a browser tab), a 10-minute
 * cache retention, and retries off unless a hook opts in.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });
}
