/** Generic forward-pagination envelope. `continuation` is an opaque handle minted
 * by the adapter (youtubei.js feed objects cannot cross IPC — see plan Approach). */
export interface Paged<T> {
  items: T[];
  continuation?: string;
}

/** Result of resolving an arbitrary YouTube URL / share link. */
export type NavTarget =
  | { kind: 'video'; videoId: string; startSec?: number }
  | { kind: 'channel'; channelId: string }
  | { kind: 'playlist'; playlistId: string }
  | { kind: 'search'; query: string }
  | { kind: 'unknown'; url: string };

/** Feeds the PRD §8 diagnostics panel. */
export interface AdapterDiagnostics {
  youtubeiVersion: string;
  lastClient: string | null;
  ladder: {
    client: string;
    ok: boolean;
    formats: number;
    lastError: string | null;
  }[];
}
