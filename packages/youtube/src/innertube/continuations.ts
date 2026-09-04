/**
 * An opaque-handle store for pagination state.
 *
 * youtubei.js feed objects are live class instances with methods
 * (`getContinuation()`, `applySort()`) and cannot survive `structuredClone`
 * across the Electron IPC boundary (plan Approach). So the adapter returns plain
 * DTOs plus an opaque string handle, and keeps the real object here — a TTL'd LRU
 * keyed by that handle.
 *
 * **Kind-namespaced + identity-deduped (plan P2-2(a), the F13 structural fix):**
 *
 *  - Handles are `` `${kind}:${uuid}` ``. `get(kind, handle)` returns `undefined`
 *    unless the handle's prefix matches `kind` — handles are untrusted renderer
 *    input (decisions A9), and feeding a `yt:comments` handle to `yt:channel`
 *    would otherwise land as a `TypeError` deep inside youtubei.js.
 *  - A `WeakMap<object, Map<kind, handle>>` dedupes by object identity: `put`ing
 *    the same live object under the same kind returns the *existing* handle
 *    instead of minting a second one. An in-place-mutating feed (the watch-next
 *    `VideoInfo`, a `CommentThread`) can therefore only ever have one handle per
 *    kind — F13's "two handles, one silently-newer object" is structurally
 *    impossible rather than merely avoided.
 *
 * TTL is 30 min and the cap is 100: Phase 2 has several concurrent continuation
 * kinds and reading a long comment thread for minutes before pressing "load
 * more" must not fail.
 */
import { randomUUID } from 'node:crypto';

export type ContinuationKind =
  'search' | 'comments' | 'replies-first' | 'replies-more' | 'channel' | 'playlist';

export interface ContinuationStoreOptions {
  ttlMs?: number;
  cap?: number;
  now?: () => number;
}

interface Entry {
  kind: ContinuationKind;
  value: unknown;
  expiresAt: number;
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

export class ContinuationStore {
  readonly #ttlMs: number;
  readonly #cap: number;
  readonly #now: () => number;
  /** Insertion-ordered — first key is the least-recently-used entry. */
  readonly #entries = new Map<string, Entry>();
  /** Identity index: object → its live handle per kind. Replaced by `clear()`. */
  #byIdentity = new WeakMap<object, Map<ContinuationKind, string>>();

  constructor(opts: ContinuationStoreOptions = {}) {
    this.#ttlMs = opts.ttlMs ?? 30 * 60_000;
    this.#cap = Math.max(1, opts.cap ?? 100);
    this.#now = opts.now ?? Date.now;
  }

  /**
   * Store a continuation object under `kind`; returns the handle for the
   * renderer. Re-`put`ting the same object under the same kind returns the
   * existing live handle (and refreshes its TTL + recency).
   */
  put(kind: ContinuationKind, value: unknown): string {
    this.#purge();

    if (isObject(value)) {
      const existing = this.#byIdentity.get(value)?.get(kind);
      if (existing !== undefined) {
        const entry = this.#entries.get(existing);
        if (entry !== undefined && this.#now() < entry.expiresAt) {
          entry.expiresAt = this.#now() + this.#ttlMs;
          entry.value = value;
          this.#entries.delete(existing);
          this.#entries.set(existing, entry);
          return existing;
        }
        // The prior handle lapsed (TTL / eviction) — forget it and mint anew.
        this.#byIdentity.get(value)?.delete(kind);
      }
    }

    const handle = `${kind}:${randomUUID()}`;
    this.#entries.set(handle, { kind, value, expiresAt: this.#now() + this.#ttlMs });
    if (isObject(value)) {
      let perKind = this.#byIdentity.get(value);
      if (perKind === undefined) {
        perKind = new Map();
        this.#byIdentity.set(value, perKind);
      }
      perKind.set(kind, handle);
    }
    this.#evict();
    return handle;
  }

  /**
   * Retrieve a stored object, or `undefined` if the handle is unknown, expired,
   * or does not belong to `kind`.
   */
  get(kind: ContinuationKind, handle: string): unknown {
    if (typeof handle !== 'string' || !handle.startsWith(`${kind}:`)) return undefined;
    const entry = this.#entries.get(handle);
    if (entry === undefined || entry.kind !== kind) return undefined;
    if (this.#now() >= entry.expiresAt) {
      this.#drop(handle, entry);
      return undefined;
    }
    // Bump recency (LRU).
    this.#entries.delete(handle);
    this.#entries.set(handle, entry);
    return entry.value;
  }

  get size(): number {
    return this.#entries.size;
  }

  clear(): void {
    this.#entries.clear();
    this.#byIdentity = new WeakMap();
  }

  /** Remove one entry from both the handle map and the identity index. */
  #drop(handle: string, entry: Entry): void {
    this.#entries.delete(handle);
    if (isObject(entry.value)) {
      const perKind = this.#byIdentity.get(entry.value);
      if (perKind?.get(entry.kind) === handle) perKind.delete(entry.kind);
    }
  }

  /** Drop everything expired. */
  #purge(): void {
    const t = this.#now();
    for (const [handle, entry] of this.#entries) {
      if (t >= entry.expiresAt) this.#drop(handle, entry);
    }
  }

  /** Enforce the cap by evicting least-recently-used entries. */
  #evict(): void {
    while (this.#entries.size > this.#cap) {
      const oldest = this.#entries.entries().next().value;
      if (oldest === undefined) break;
      this.#drop(oldest[0], oldest[1]);
    }
  }
}
