import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { encodeTargetParam } from './allowlist.js';
import { DEFAULT_IMAGE_CACHE_BYTES, ImageCache } from './imageCache.js';
import { createProxyServer } from './server.js';

/**
 * Public face of the media proxy — the only module the rest of `main` imports
 * (plan Architecture → "The media proxy", decision A6: media, thumbnails and
 * captions reach the renderer over loopback HTTP, never over IPC).
 *
 * Deliberately free of any `electron` import so it is unit-testable in the
 * plain-node vitest project; the caller supplies `cacheDir`
 * (`app.getPath('userData')/thumbs`) and the renderer origin.
 *
 * The token is 32 random bytes, hex-encoded, minted per launch. It is a
 * capability, not a secret to be persisted: anything that can read it can
 * already read the app's memory.
 */

export const LOOPBACK_HOST = '127.0.0.1';

export interface StartProxyOptions {
  /**
   * Renderer origin allowed to read proxied responses — `app://bundle` in a
   * packaged build, the electron-vite dev server origin (e.g.
   * `http://localhost:5173`) in dev.
   */
  readonly allowedOrigin: string;
  /** Directory for the thumbnail cache, e.g. `userData/thumbs`. */
  readonly cacheDir: string;
  /** Byte cap for the thumbnail cache. Defaults to 512 MB (settings `thumbnailCacheMb`). */
  readonly imageCacheBytes?: number;
}

export interface MediaProxy {
  /** Resolved loopback port (the server binds port 0). */
  readonly port: number;
  /** Per-launch path token. */
  readonly token: string;
  /** `http://127.0.0.1:<port>/<token>` — every route hangs off this. */
  readonly base: string;
  /** `(googlevideo URL) → proxied URL`. Injected into P1-3's `url_transformer`. */
  mediaUrl(target: string): string;
  /** `(ytimg/ggpht URL) → proxied URL`, disk-cached. */
  imageUrl(target: string): string;
  /** `(youtube.com/api/timedtext URL) → proxied URL`. */
  captionUrl(target: string): string;
  /** Idempotent. Call from `before-quit`. */
  close(): Promise<void>;
}

export async function startProxy(options: StartProxyOptions): Promise<MediaProxy> {
  const token = randomBytes(32).toString('hex');
  const imageCache = new ImageCache({
    dir: options.cacheDir,
    maxBytes: options.imageCacheBytes ?? DEFAULT_IMAGE_CACHE_BYTES,
  });

  const server = createProxyServer({
    token,
    allowedOrigin: options.allowedOrigin,
    imageCache,
  });

  const port = await new Promise<number>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(0, LOOPBACK_HOST, () => {
      server.off('error', onError);
      const address = server.address() as AddressInfo | null;
      if (address === null) {
        reject(new Error('proxy server produced no address'));
        return;
      }
      resolve(address.port);
    });
  });

  const base = `http://${LOOPBACK_HOST}:${port}/${token}`;
  const route = (name: string, target: string): string =>
    `${base}/${name}?u=${encodeTargetParam(target)}`;

  let closed: Promise<void> | null = null;

  return {
    port,
    token,
    base,
    mediaUrl: (target) => route('media', target),
    imageUrl: (target) => route('img', target),
    captionUrl: (target) => route('caption', target),
    close(): Promise<void> {
      closed ??= new Promise<void>((resolve) => {
        server.close(() => resolve());
        // `close()` alone waits for idle keep-alive sockets; on quit we do not.
        server.closeAllConnections();
      });
      return closed;
    },
  };
}

export { DEFAULT_IMAGE_CACHE_BYTES, ImageCache } from './imageCache.js';
export { PRODUCTION_ROUTES, encodeTargetParam } from './allowlist.js';
