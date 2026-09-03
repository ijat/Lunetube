/**
 * Opt-in live smoke test. Skipped unless `LUNE_LIVE=1` — **never runs in CI**
 * (GitHub datacenter IPs are bot-blocked; plan F2/R2). Run locally with:
 *
 *   LUNE_LIVE=1 pnpm --filter @lunetube/youtube test
 *
 * It hits real YouTube: `getVideo` + `getStreams` for the plan's F2 test IDs.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InnertubeYouTubeSource } from '../innertube/source.js';
import { identityRewriter } from '../contract.js';

const LIVE = process.env['LUNE_LIVE'] === '1';
const IDS = ['LXb3EKWsInQ', 'aqz-KE-bpKQ'];

describe.skipIf(!LIVE)('live YouTube (LUNE_LIVE=1)', () => {
  const source = new InnertubeYouTubeSource({
    cacheDir: mkdtempSync(join(tmpdir(), 'lunetube-live-')),
    rewriters: { media: identityRewriter },
  });

  it.each(IDS)(
    'getVideo(%s) succeeds',
    async (id) => {
      const res = await source.getVideo({ videoId: id });
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.title.length).toBeGreaterThan(0);
    },
    30_000,
  );

  it.each(IDS)(
    'getStreams(%s) resolves adaptive formats',
    async (id) => {
      const res = await source.getStreams({
        videoId: id,
        prefs: { maxHeight: 'auto', preferredAudioLanguage: null, audioOnly: false },
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.video.length).toBeGreaterThan(0);
        expect(res.value.audio.length).toBeGreaterThan(0);
        expect(res.value.manifestXml).toContain('<MPD');
      }
    },
    30_000,
  );
});
