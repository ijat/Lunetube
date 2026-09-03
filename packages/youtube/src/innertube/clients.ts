/**
 * The InnerTube client ladder, as data.
 *
 * Empirically probed anonymously on **2026-09-03** (plan F2) from a residential
 * IP with `Innertube.create({ cache: new UniversalCache(false) })` — no PO token,
 * no BotGuard runtime, no cookies:
 *
 * | client      | playability                         | adaptive fmts | fmts w/ URL | media fetch          |
 * |-------------|-------------------------------------|---------------|-------------|----------------------|
 * | `IOS`       | OK                                  | 30            | 30          | **HTTP 206, bytes**  |
 * | `MWEB`      | OK                                  | 57            | 57          | HTTP 403 (needs GVS PO token) |
 * | `WEB`       | OK                                  | 48            | 0           | n/a — SABR-only      |
 * | `TV`        | LOGIN_REQUIRED "not a bot"           | 0             | 0           | n/a                  |
 * | `ANDROID`   | OK                                  | 0             | 0           | n/a                  |
 * | `ANDROID_VR`| LOGIN_REQUIRED                      | 0             | 0           | n/a                  |
 *
 * Conclusion: **`IOS` is the only client that resolves directly-playable
 * adaptive streams anonymously today.** 4K/60 confirmed for `LXb3EKWsInQ` and
 * `aqz-KE-bpKQ` (av01 / vp09 / avc1). Treat this as *true-today-here*, not
 * *true-forever* (plan R1/R2) — hence a ladder, not a constant.
 */
import type { Types } from 'youtubei.js';

export type InnerTubeClient = Types.InnerTubeClient;

export interface ClientLadderEntry {
  client: InnerTubeClient;
  /** Returns adaptive formats that carry a usable `url` (vs SABR-only). */
  directUrls: boolean;
  /** Media URLs 403 without a GVS Proof-of-Origin token. No PO-token provider exists in Phase 1. */
  needsPoToken: boolean;
  /** Only reachable through the SABR streaming protocol (`googlevideo` adapter — deferred, plan F3). */
  sabrOnly: boolean;
}

export const CLIENT_LADDER: readonly ClientLadderEntry[] = [
  { client: 'IOS', directUrls: true, needsPoToken: false, sabrOnly: false },
  { client: 'MWEB', directUrls: true, needsPoToken: true, sabrOnly: false },
  { client: 'WEB', directUrls: false, needsPoToken: true, sabrOnly: true },
];

/**
 * What the adapter can currently do. Both are `false` in Phase 1; they are the
 * wiring points for a PO-token provider and for `SabrStrategy`.
 */
export interface ClientCapabilities {
  hasPoToken?: boolean;
  hasSabr?: boolean;
}

/**
 * Why a ladder entry cannot be attempted, as a sentence a user (or the PRD §8
 * diagnostics panel) can act on — or `null` when it *can* be attempted.
 *
 * This is the single source of truth for the skip logic: `attemptableClients`
 * is defined in terms of it, so the reason shown in diagnostics can never drift
 * from the reason a client was actually skipped.
 */
export function ladderSkipReason(
  entry: ClientLadderEntry,
  caps: ClientCapabilities = {},
): string | null {
  if (entry.sabrOnly && !caps.hasSabr) {
    return `${entry.client} serves media over SABR only, and the SABR playback strategy is not implemented (packages/youtube/src/playback/sabr.ts).`;
  }
  if (entry.needsPoToken && !caps.hasPoToken) {
    return `${entry.client} needs a Proof-of-Origin token for googlevideo, and this build has no PO-token provider — its media URLs would return HTTP 403.`;
  }
  return null;
}

/**
 * The subset of the ladder we can actually attempt right now. With no PO-token
 * provider and no SABR strategy, that is `IOS` alone; the rest stay in the ladder
 * as documentation and as ready slots for a future SABR / PO-token phase.
 */
export function attemptableClients(caps: ClientCapabilities = {}): ClientLadderEntry[] {
  return CLIENT_LADDER.filter((entry) => ladderSkipReason(entry, caps) === null);
}
