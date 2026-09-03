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
  /** InnerTube client that produced the most recent stream manifest. */
  lastClient: string | null;
  /**
   * `expiresAt` of the most recent stream manifest (epoch ms), or `null` before
   * any stream has been resolved. Shown next to `lastClient` so a "it stopped
   * playing after a while" report can be told apart from a client-level block.
   */
  lastExpiresAt: number | null;
  ladder: {
    client: string;
    ok: boolean;
    formats: number;
    /**
     * The last failure for this client — or, for a client this build cannot
     * attempt at all, the reason it is skipped (missing PO-token provider,
     * SABR-only). Never silently `null` for an unusable entry.
     */
    lastError: string | null;
  }[];
}
