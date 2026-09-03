/**
 * Fixture loading for `FakeYouTubeSource` and the mapper tests.
 *
 * A fixture is a hand-authored (or `pnpm fixtures:record`-generated) JSON file
 * shaped like the subset of youtubei.js `VideoInfo` that the mappers read, plus
 * a `meta` block and an optional pre-rendered `dash_manifest_xml`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RawCaptions, RawStoryboards, RawStreamingData } from '../innertube/map/streams.js';
import type { RawFeedVideoNode, RawVideoInfo } from '../innertube/map/video.js';

export interface VideoFixture extends RawVideoInfo {
  meta?: {
    videoId?: string;
    client?: string;
    recordedAt?: string;
    note?: string;
  };
  playability_status?: { status?: string; reason?: string } | null;
  streaming_data?: RawStreamingData | null;
  captions?: RawCaptions | null;
  storyboards?: RawStoryboards | null;
  wn_has_continuation?: boolean;
  watch_next_feed?: RawFeedVideoNode[] | null;
  /** Pre-rendered DASH manifest (from a real capture); synthesised when absent. */
  dash_manifest_xml?: string;
}

/** The directory shipped with the package: `packages/youtube/tests/fixtures`. */
export function defaultFixturesDir(): string {
  return fileURLToPath(new URL('../../tests/fixtures', import.meta.url));
}

/** Load every `video-*.json` fixture, keyed by both `meta.videoId` and file stem. */
export function loadVideoFixtures(dir: string = defaultFixturesDir()): Map<string, VideoFixture> {
  const out = new Map<string, VideoFixture>();
  for (const entry of readdirSync(dir)) {
    if (!entry.startsWith('video-') || !entry.endsWith('.json')) continue;
    const fixture = JSON.parse(readFileSync(`${dir}/${entry}`, 'utf8')) as VideoFixture;
    const stem = entry.slice(0, -'.json'.length);
    out.set(stem, fixture);
    const id = fixture.meta?.videoId;
    if (typeof id === 'string' && id.length > 0) out.set(id, fixture);
  }
  return out;
}

/** Load one fixture by file stem (e.g. `"video-normal"`). Throws if missing. */
export function loadVideoFixture(stem: string, dir: string = defaultFixturesDir()): VideoFixture {
  return JSON.parse(readFileSync(`${dir}/${stem}.json`, 'utf8')) as VideoFixture;
}
