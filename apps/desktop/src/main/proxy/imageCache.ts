import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

/**
 * Content-addressed thumbnail cache (plan P1-2, PRD §9 "lazy + cached
 * thumbnails (disk cache)").
 *
 * Design notes that are load-bearing:
 *
 * - **The filename is the whole index.** `<sha256(url)>.<ext>` where `ext`
 *   encodes the content type. One file per entry means a commit is a single
 *   `rename()` — atomic on both POSIX and NTFS within a directory — so a
 *   concurrent reader never observes a partially-written entry and there is no
 *   sidecar that can drift out of sync with its payload.
 * - **Writes go to a per-write unique temp name**, so two callers racing on the
 *   same URL cannot corrupt each other's file. Both write complete bytes; the
 *   later `rename` wins, and either result is byte-identical.
 * - **The in-memory index is a hint, not the truth.** It is built once by
 *   scanning the directory and is used only to answer "which entry is least
 *   recently used" and "how many bytes are on disk". A missing file at read
 *   time is a cache miss, not an error.
 * - **Recency is a monotonic counter, not a timestamp.** Filesystem atime is
 *   `relatime`/`noatime` on most modern mounts, and `Date.now()` only has
 *   millisecond resolution — thumbnails arrive far faster than that, so a
 *   wall-clock LRU ties constantly and degenerates into evicting by insertion
 *   order. The on-disk `mtimeMs` is used once, at scan time, purely to order
 *   pre-existing entries against each other.
 *
 * Complexity: `lookup` and `store` are O(1) in the number of entries; eviction
 * is O(n log n) only when the cap is exceeded (it sorts the index once per
 * over-cap store, then evicts until under). The startup scan is O(n) stat
 * calls, done lazily on first use and shared by all concurrent callers. At the
 * real scale here — a 512 MB cap over ~30 KB thumbnails, so O(10^4) files —
 * that is a few tens of milliseconds, once, off the request path for every
 * request but the first.
 */

/** Content types we are willing to persist, and the extension each maps to. */
const EXT_BY_TYPE: ReadonlyMap<string, string> = new Map([
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/avif', 'avif'],
]);

const TYPE_BY_EXT: ReadonlyMap<string, string> = new Map([
  ['jpg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
  ['gif', 'image/gif'],
  ['avif', 'image/avif'],
]);

const ENTRY_FILENAME = /^([0-9a-f]{64})\.(jpg|png|webp|gif|avif)$/;

/**
 * Nothing bigger than this is cached, whatever the cap is. A single entry that
 * could evict most of the cache is worse than not caching it; thumbnails and
 * storyboard sheets are comfortably under 1 MB.
 */
export const MAX_ENTRY_BYTES = 16 * 1024 * 1024;

export const DEFAULT_IMAGE_CACHE_BYTES = 512 * 1024 * 1024;

/** Content address of a target URL. The URL string is the key; nothing else. */
export function cacheKey(url: string): string {
  return createHash('sha256').update(url, 'utf8').digest('hex');
}

/** `image/jpeg; charset=x` → `jpg`, or `null` when the type is not cacheable. */
export function extensionForContentType(contentType: string | undefined): string | null {
  if (typeof contentType !== 'string') return null;
  const base = contentType.split(';', 1)[0]?.trim().toLowerCase();
  if (base === undefined) return null;
  return EXT_BY_TYPE.get(base) ?? null;
}

export interface CacheHit {
  readonly path: string;
  readonly contentType: string;
  readonly size: number;
}

interface Entry {
  readonly ext: string;
  size: number;
  /** Monotonic recency rank; higher is more recently used. */
  rank: number;
}

export class ImageCache {
  readonly #dir: string;
  readonly #maxBytes: number;
  readonly #entries = new Map<string, Entry>();
  #totalBytes = 0;
  #ready: Promise<void> | null = null;
  #rank = 0;

  constructor(options: { dir: string; maxBytes?: number }) {
    this.#dir = options.dir;
    this.#maxBytes = Math.max(0, options.maxBytes ?? DEFAULT_IMAGE_CACHE_BYTES);
  }

  get maxBytes(): number {
    return this.#maxBytes;
  }

  /** Bytes currently accounted for on disk. Test/diagnostic surface. */
  get totalBytes(): number {
    return this.#totalBytes;
  }

  get entryCount(): number {
    return this.#entries.size;
  }

  /** Idempotent, concurrency-safe lazy init: every caller awaits the same scan. */
  async ready(): Promise<void> {
    this.#ready ??= this.#scan();
    await this.#ready;
  }

  async #scan(): Promise<void> {
    await mkdir(this.#dir, { recursive: true });
    let names: string[];
    try {
      names = await readdir(this.#dir);
    } catch {
      return;
    }

    const found: { key: string; ext: string; size: number; mtimeMs: number }[] = [];
    for (const name of names) {
      const match = ENTRY_FILENAME.exec(name);
      if (match === null) {
        // Orphaned `.tmp` from a crash mid-write. Best-effort cleanup; a
        // failure here must never make the cache unusable.
        if (name.endsWith('.tmp')) await unlink(join(this.#dir, name)).catch(() => undefined);
        continue;
      }
      const key = match[1];
      const ext = match[2];
      if (key === undefined || ext === undefined) continue;
      try {
        const info = await stat(join(this.#dir, name));
        if (!info.isFile()) continue;
        found.push({ key, ext, size: info.size, mtimeMs: info.mtimeMs });
      } catch {
        /* vanished between readdir and stat — ignore */
      }
    }

    // Oldest first, so ranks come out ascending and anything touched in this
    // process outranks every pre-existing entry.
    found.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const item of found) {
      this.#entries.set(item.key, { ext: item.ext, size: item.size, rank: this.#rank++ });
      this.#totalBytes += item.size;
    }
  }

  async lookup(key: string): Promise<CacheHit | null> {
    if (this.#maxBytes === 0) return null;
    await this.ready();

    const entry = this.#entries.get(key);
    if (entry === undefined) return null;

    const contentType = TYPE_BY_EXT.get(entry.ext);
    if (contentType === undefined) return null;

    const path = join(this.#dir, `${key}.${entry.ext}`);
    // Confirm the file is still there before promising a hit — a user (or
    // another LuneTube instance) may have cleared the directory underneath us.
    try {
      const info = await stat(path);
      if (!info.isFile()) throw new Error('not a file');
      entry.size = info.size;
    } catch {
      this.#forget(key);
      return null;
    }

    entry.rank = this.#rank++;
    return { path, contentType, size: entry.size };
  }

  /**
   * Consumes `source` to completion and, if it produced a complete, cacheable
   * body, commits it under `key`. Never rejects: a cache write failing must not
   * fail the request it was riding along with. Resolves `true` on commit.
   *
   * `expectedBytes` is the upstream `Content-Length` when known; a body that
   * does not match it is treated as truncated and discarded, so a connection
   * that dies mid-thumbnail cannot poison the cache with a half image.
   */
  async store(
    key: string,
    contentType: string | undefined,
    source: Readable,
    expectedBytes?: number,
  ): Promise<boolean> {
    const ext = extensionForContentType(contentType);
    if (this.#maxBytes === 0 || ext === null) {
      source.resume(); // drain so the upstream socket is not held open
      return false;
    }
    if (expectedBytes !== undefined && expectedBytes > this.#entryCap()) {
      source.resume();
      return false;
    }

    try {
      await this.ready();
    } catch {
      source.resume();
      return false;
    }

    const tmpPath = join(this.#dir, `${key}.${randomUUID()}.tmp`);
    const finalPath = join(this.#dir, `${key}.${ext}`);
    const cap = this.#entryCap();

    let written = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        const out = createWriteStream(tmpPath);
        let settled = false;
        const fail = (error: unknown): void => {
          if (settled) return;
          settled = true;
          source.off('data', onData);
          out.destroy();
          reject(error instanceof Error ? error : new Error(String(error)));
        };
        function onData(chunk: Buffer | string): void {
          written += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
          if (written > cap) {
            source.destroy();
            fail(new Error('entry exceeds cap'));
          }
        }
        source.on('data', onData);
        source.on('error', fail);
        // A source destroyed *without* an error never emits `error` and never
        // ends the writable, so `close` would never fire and this promise would
        // hang forever, holding the temp file. Catch that explicitly.
        source.on('close', () => {
          if (!source.readableEnded) fail(new Error('source closed before end'));
        });
        out.on('error', fail);
        // `close`, not `finish`: the rename below must not run while the write
        // fd is still open. POSIX tolerates that; Windows `MoveFileEx` does not,
        // and CI builds on windows-latest.
        out.on('close', () => {
          if (settled) return;
          settled = true;
          resolve();
        });
        source.pipe(out);
      });

      if (expectedBytes !== undefined && written !== expectedBytes) {
        throw new Error('truncated body');
      }
      if (written === 0) throw new Error('empty body');

      await rename(tmpPath, finalPath);
    } catch {
      await unlink(tmpPath).catch(() => undefined);
      return false;
    }

    this.#remember(key, ext, written);
    await this.#evict(key);
    return true;
  }

  #entryCap(): number {
    return Math.min(MAX_ENTRY_BYTES, this.#maxBytes);
  }

  #remember(key: string, ext: string, size: number): void {
    const previous = this.#entries.get(key);
    if (previous !== undefined) this.#totalBytes -= previous.size;
    this.#entries.set(key, { ext, size, rank: this.#rank++ });
    this.#totalBytes += size;
  }

  #forget(key: string): void {
    const entry = this.#entries.get(key);
    if (entry === undefined) return;
    this.#totalBytes -= entry.size;
    this.#entries.delete(key);
  }

  /**
   * LRU eviction down to the cap. `keep` is the entry just written — evicting
   * it immediately would make a cold cache thrash without ever serving a hit.
   */
  async #evict(keep: string): Promise<void> {
    if (this.#totalBytes <= this.#maxBytes) return;

    const candidates = [...this.#entries.entries()]
      .filter(([key]) => key !== keep)
      .sort((a, b) => a[1].rank - b[1].rank);

    for (const [key, entry] of candidates) {
      if (this.#totalBytes <= this.#maxBytes) break;
      this.#forget(key);
      await unlink(join(this.#dir, `${key}.${entry.ext}`)).catch(() => undefined);
    }
  }
}
