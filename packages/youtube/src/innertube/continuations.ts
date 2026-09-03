/**
 * An opaque-handle store for pagination state.
 *
 * youtubei.js feed objects are live class instances with methods
 * (`getContinuation()`, `applySort()`) and cannot survive `structuredClone`
 * across the Electron IPC boundary (plan Approach). So the adapter returns plain
 * DTOs plus an opaque string handle, and keeps the real object here — a TTL'd LRU
 * (5 min, cap 50) keyed by that handle.
 */
import { randomUUID } from 'node:crypto';

export interface ContinuationStoreOptions {
  ttlMs?: number;
  cap?: number;
  now?: () => number;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

export class ContinuationStore {
  readonly #ttlMs: number;
  readonly #cap: number;
  readonly #now: () => number;
  readonly #entries = new Map<string, Entry>();

  constructor(opts: ContinuationStoreOptions = {}) {
    this.#ttlMs = opts.ttlMs ?? 5 * 60_000;
    this.#cap = Math.max(1, opts.cap ?? 50);
    this.#now = opts.now ?? Date.now;
  }

  /** Store a feed object; returns the handle to hand back to the renderer. */
  put(value: unknown): string {
    this.#purge();
    const handle = randomUUID();
    this.#entries.set(handle, { value, expiresAt: this.#now() + this.#ttlMs });
    while (this.#entries.size > this.#cap) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    return handle;
  }

  /** Retrieve a stored feed object, or `undefined` if unknown / expired. */
  get(handle: string): unknown {
    const entry = this.#entries.get(handle);
    if (entry === undefined) return undefined;
    if (this.#now() >= entry.expiresAt) {
      this.#entries.delete(handle);
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
  }

  #purge(): void {
    const t = this.#now();
    for (const [handle, entry] of this.#entries) {
      if (t >= entry.expiresAt) this.#entries.delete(handle);
    }
  }
}
