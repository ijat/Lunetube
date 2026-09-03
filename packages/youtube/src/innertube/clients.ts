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
 * The subset of the ladder we can actually attempt right now. With no PO-token
 * provider and no SABR strategy, that is `IOS` alone; the rest stay in the ladder
 * as documentation and as ready slots for P1-3 / a future SABR phase.
 */
export function attemptableClients(
  opts: { hasPoToken?: boolean; hasSabr?: boolean } = {},
): ClientLadderEntry[] {
  return CLIENT_LADDER.filter((e) => {
    if (e.needsPoToken && !opts.hasPoToken) return false;
    if (e.sabrOnly && !opts.hasSabr) return false;
    return true;
  });
}
