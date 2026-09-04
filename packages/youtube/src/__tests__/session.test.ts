import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { youtubeiVersion } from '../innertube/session.js';

/**
 * `youtubeiVersion()` resolves the version at build time (F12). This pins it
 * against the actually-installed package so a `pnpm update youtubei.js` that
 * forgets to touch anything else still turns a test red rather than silently
 * shipping a stale version string in the diagnostics panel.
 */
describe('youtubeiVersion', () => {
  it('equals the installed youtubei.js package version', () => {
    const require = createRequire(import.meta.url);
    const installed = JSON.parse(
      readFileSync(require.resolve('youtubei.js/package.json'), 'utf8'),
    ) as { version: string };

    expect(installed.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(youtubeiVersion()).toBe(installed.version);
  });
});
