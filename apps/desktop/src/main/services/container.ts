import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import {
  FakeYouTubeSource,
  InnertubeYouTubeSource,
  type MediaUrlRewriters,
  type YouTubeSource,
} from '@lunetube/youtube';
import type { MediaProxy } from '../proxy/index.js';

/**
 * The main-process DI container (plan P1-4).
 *
 * Constructs the singleton `YouTubeSource` once, after the media proxy is up,
 * and injects the three URL rewriters built from the proxy handle so
 * `packages/youtube` stays ignorant of the proxy's existence (contract:
 * `MediaUrlRewriters`).
 *
 * `LUNE_FAKE_YT=1` swaps in `FakeYouTubeSource` — this is how the Playwright
 * suite runs with no network (CI IPs are bot-blocked; plan R2). The fake never
 * touches the proxy for its rewriters; the proxy may be up but is simply unused.
 * `LUNE_FIXTURES_DIR` points the fake at an explicit fixtures directory (the
 * bundled `out/main` build cannot resolve the package-relative default).
 */

let source: YouTubeSource | null = null;

export interface ContainerDeps {
  readonly proxy: MediaProxy;
}

export function initContainer({ proxy }: ContainerDeps): void {
  if (source !== null) throw new Error('services container already initialised');
  source = process.env['LUNE_FAKE_YT'] === '1' ? createFake() : createReal(proxy);
}

function createReal(proxy: MediaProxy): YouTubeSource {
  const rewriters: MediaUrlRewriters = {
    media: (url) => new URL(proxy.mediaUrl(url.toString())),
    image: (url) => new URL(proxy.imageUrl(url.toString())),
    caption: (url) => new URL(proxy.captionUrl(url.toString())),
  };
  const cacheDir = join(app.getPath('userData'), 'ytcache');
  // youtubei.js's UniversalCache writes with no `mode`, so create the directory
  // ourselves at 0700 first — it holds the persisted InnerTube session incl. the
  // stable anonymous `visitor_data` (S1). 0700 gates traversal, so the mode-less
  // files land inside a private dir. No-op on Windows (ACLs).
  mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  return new InnertubeYouTubeSource({ cacheDir, rewriters });
}

function createFake(): YouTubeSource {
  const fixturesDir = process.env['LUNE_FIXTURES_DIR'];
  return new FakeYouTubeSource(fixturesDir ? { fixturesDir } : {});
}

/** The singleton `YouTubeSource`. Throws if `initContainer` has not run. */
export function youtubeSource(): YouTubeSource {
  if (source === null) {
    throw new Error('services container not initialised — call initContainer() first');
  }
  return source;
}
