/**
 * Lazily-created, cached `Innertube` instance.
 *
 * - The InnerTube session (API keys, player JS, and **`visitor_data`**) is
 *   persisted to a `UniversalCache` under a caller-supplied directory, so the
 *   anonymous identity is stable across launches (better content, fewer
 *   bot checks).
 * - `packages/youtube` must not import `electron`; the cache directory is passed
 *   in as a plain string (main resolves it under `app.getPath('userData')`).
 * - `refresh()` throws away the instance and rebuilds it — the recovery move for
 *   `YT_PARSE_CHANGED` (stale player JS).
 */
import { Innertube, UniversalCache } from 'youtubei.js';
// Resolved at **build time** — youtubei.js is bundled into the app, so a
// runtime `require('youtubei.js/package.json')` finds nothing in a packaged
// build and `youtubeiVersion()` would report `'unknown'` in every real install
// (F12). rollup/tsc inline this JSON. `session.test.ts` pins it against the
// installed package so it cannot drift.
import youtubeiPkg from 'youtubei.js/package.json' with { type: 'json' };

type InnertubeConfig = Parameters<typeof Innertube.create>[0];

export interface InnertubeSessionOptions {
  /** Directory for the persistent InnerTube cache (session data + player JS). */
  cacheDir: string;
  /** Test seam — defaults to the real `Innertube.create`. */
  createInnertube?: (config: InnertubeConfig) => Promise<Innertube>;
}

export class InnertubeSession {
  readonly #opts: InnertubeSessionOptions;
  #pending: Promise<Innertube> | null = null;

  constructor(opts: InnertubeSessionOptions) {
    this.#opts = opts;
  }

  /** The shared instance, created on first use. */
  get(): Promise<Innertube> {
    return (this.#pending ??= this.#create());
  }

  /** Force a fresh instance + player JS (recovery from a parser break). */
  refresh(): Promise<Innertube> {
    this.#pending = this.#create();
    return this.#pending;
  }

  #create(): Promise<Innertube> {
    const factory = this.#opts.createInnertube ?? ((config) => Innertube.create(config));
    const create = factory({
      cache: new UniversalCache(true, this.#opts.cacheDir),
      retrieve_player: true,
    }).catch((err: unknown) => {
      // Don't cache a rejected promise — allow the next call to retry.
      this.#pending = null;
      throw err;
    });
    return create;
  }
}

/** The installed youtubei.js version, for the diagnostics panel (PRD §8). */
export function youtubeiVersion(): string {
  const version = (youtubeiPkg as { version?: unknown }).version;
  return typeof version === 'string' ? version : 'unknown';
}
