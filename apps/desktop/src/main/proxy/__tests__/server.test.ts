import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { encodeTargetParam, type RouteName, type RouteRule } from '../allowlist.js';
import { cacheKey, ImageCache } from '../imageCache.js';
import { createProxyServer } from '../server.js';

/**
 * Integration tests run the real server against a **local fixture origin** — no
 * network, ever. Only the route table is swapped (that is the sole reason
 * `createProxyServer` accepts one); the token gate, header handling, redirect
 * re-checking, streaming and cache are all the production code paths.
 *
 * The last block re-runs a couple of requests through the **default**
 * (production) route table to prove the swap is genuinely test-only and that
 * the shipped wiring rejects a loopback target.
 */

const TOKEN = 'a'.repeat(64);
const ORIGIN = 'app://bundle';

const loopbackRule = (name: RouteName, pathname?: RegExp): RouteRule =>
  pathname === undefined
    ? { name, protocols: ['http:'], host: /^127\.0\.0\.1$/ }
    : { name, protocols: ['http:'], host: /^127\.0\.0\.1$/, pathname };

const TEST_ROUTES: Readonly<Record<RouteName, RouteRule>> = {
  media: loopbackRule('media'),
  img: loopbackRule('img'),
  caption: loopbackRule('caption', /^\/caption$/),
};

// 1 MiB of deterministic bytes so ranges are checkable by value, not just length.
const MEDIA = Buffer.from(Uint8Array.from({ length: 1024 * 1024 }, (_v, i) => (i * 31 + 7) % 256));
const JPEG = Buffer.from(Uint8Array.from({ length: 4096 }, (_v, i) => i % 256));

interface Received {
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
}

let origin: Server;
let originPort = 0;
let received: Received[] = [];

function originUrl(path: string): string {
  return `http://127.0.0.1:${originPort}${path}`;
}

function serveRanged(req: IncomingMessage, res: ServerResponse, body: Buffer, type: string): void {
  const range = req.headers['range'];
  if (typeof range !== 'string') {
    res.writeHead(200, {
      'content-type': type,
      'content-length': String(body.length),
      'accept-ranges': 'bytes',
    });
    res.end(body);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (match === null) {
    res.writeHead(416, { 'content-range': `bytes */${body.length}` });
    res.end();
    return;
  }
  const start = match[1] === '' ? 0 : Number(match[1]);
  const end = match[2] === '' ? body.length - 1 : Number(match[2]);
  if (start >= body.length || start > end) {
    res.writeHead(416, { 'content-range': `bytes */${body.length}` });
    res.end();
    return;
  }
  const slice = body.subarray(start, Math.min(end, body.length - 1) + 1);
  res.writeHead(206, {
    'content-type': type,
    'content-length': String(slice.length),
    'content-range': `bytes ${start}-${start + slice.length - 1}/${body.length}`,
    'accept-ranges': 'bytes',
  });
  res.end(slice);
}

beforeAll(async () => {
  origin = createServer((req, res) => {
    received.push({ url: req.url ?? '', headers: req.headers });
    const path = (req.url ?? '').split('?', 1)[0] ?? '';

    switch (path) {
      case '/media':
        serveRanged(req, res, MEDIA, 'video/mp4');
        return;
      case '/forbidden':
        res.writeHead(403, { 'content-type': 'text/plain', 'content-length': '9' });
        res.end('forbidden');
        return;
      case '/redirect':
        res.writeHead(302, { location: '/media', 'set-cookie': 'sid=leak; Path=/' });
        res.end();
        return;
      case '/redirect-offsite':
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
        res.end();
        return;
      case '/redirect-loop':
        res.writeHead(302, { location: '/redirect-loop' });
        res.end();
        return;
      case '/img.jpg':
        res.writeHead(200, {
          'content-type': 'image/jpeg',
          'content-length': String(JPEG.length),
          'set-cookie': 'sid=leak; Path=/',
        });
        res.end(JPEG);
        return;
      case '/img2.jpg':
        res.writeHead(200, {
          'content-type': 'image/jpeg',
          'content-length': String(JPEG.length),
        });
        res.end(JPEG);
        return;
      case '/img.html':
        res.writeHead(200, { 'content-type': 'text/html', 'content-length': '4' });
        res.end('nope');
        return;
      case '/caption':
        res.writeHead(200, { 'content-type': 'text/vtt', 'content-length': '13' });
        res.end('WEBVTT\n\n0:00\n');
        return;
      default:
        res.writeHead(404, { 'content-length': '0' });
        res.end();
    }
  });

  await new Promise<void>((resolve) => origin.listen(0, '127.0.0.1', resolve));
  originPort = (origin.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => origin.close(() => resolve()));
});

afterEach(() => {
  received = [];
});

interface Response {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/** Raw http client — no undici header normalisation between us and the proxy. */
function raw(
  url: string,
  options: { headers?: Record<string, string>; method?: string } = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      url,
      { method: options.method ?? 'GET', headers: options.headers ?? {} },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

interface Harness {
  base: string;
  close: () => Promise<void>;
  cache: ImageCache | null;
  cacheDir: string | null;
}

async function startHarness(
  options: { routes?: Readonly<Record<RouteName, RouteRule>>; cacheBytes?: number } = {},
): Promise<Harness> {
  let cache: ImageCache | null = null;
  let cacheDir: string | null = null;
  if (options.cacheBytes !== undefined) {
    cacheDir = await mkdtemp(join(tmpdir(), 'lunetube-proxy-'));
    cache = new ImageCache({ dir: cacheDir, maxBytes: options.cacheBytes });
  }

  const server = createProxyServer({
    token: TOKEN,
    allowedOrigin: ORIGIN,
    ...(options.routes === undefined ? {} : { routes: options.routes }),
    imageCache: cache,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    base: `http://127.0.0.1:${port}/${TOKEN}`,
    cache,
    cacheDir,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      if (cacheDir !== null) await rm(cacheDir, { recursive: true, force: true });
    },
  };
}

const u = (path: string): string => `u=${encodeTargetParam(originUrl(path))}`;

describe('proxy server — token gate', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ routes: TEST_ROUTES });
  });
  afterAll(async () => {
    await h.close();
  });

  it('rejects a wrong token with 404 and never contacts upstream', async () => {
    const bad = h.base.replace(TOKEN, 'b'.repeat(64));
    const res = await raw(`${bad}/media?${u('/media')}`);
    expect(res.status).toBe(404);
    expect(received).toHaveLength(0);
  });

  it('rejects a truncated, extended or empty token with 404', async () => {
    const port = new URL(h.base).port;
    for (const token of ['', TOKEN.slice(0, 63), `${TOKEN}a`, TOKEN.toUpperCase()]) {
      const res = await raw(`http://127.0.0.1:${port}/${token}/media?${u('/media')}`);
      expect(res.status).toBe(404);
    }
    expect(received).toHaveLength(0);
  });

  it('rejects extra or missing path segments with 404', async () => {
    for (const path of ['', '/media/extra', '/', '/../media']) {
      const res = await raw(`${h.base}${path}?${u('/media')}`);
      expect(res.status).toBe(404);
    }
    expect(received).toHaveLength(0);
  });

  it('rejects an unknown route name under a valid token', async () => {
    const res = await raw(`${h.base}/admin?${u('/media')}`);
    expect(res.status).toBe(404);
    expect(received).toHaveLength(0);
  });

  it('rejects non-GET methods', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) {
      const res = await raw(`${h.base}/media?${u('/media')}`, { method });
      expect(res.status).toBe(405);
    }
    expect(received).toHaveLength(0);
  });

  it('rejects a non-loopback Host header (DNS rebinding)', async () => {
    const res = await raw(`${h.base}/media?${u('/media')}`, {
      headers: { host: 'attacker.example' },
    });
    expect(res.status).toBe(400);
    expect(received).toHaveLength(0);
  });

  it('answers a CORS preflight without touching upstream', async () => {
    const res = await raw(`${h.base}/media?${u('/media')}`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-headers']).toContain('Range');
    expect(received).toHaveLength(0);
  });
});

describe('proxy server — /media range and status semantics', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ routes: TEST_ROUTES });
  });
  afterAll(async () => {
    await h.close();
  });

  it('passes Range through and returns 206 with a correct Content-Range', async () => {
    const res = await raw(`${h.base}/media?${u('/media')}`, {
      headers: { range: 'bytes=0-1023' },
    });

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-1023/${MEDIA.length}`);
    expect(res.headers['content-length']).toBe('1024');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(res.body.length).toBe(1024);
    expect(res.body.equals(MEDIA.subarray(0, 1024))).toBe(true);
    expect(received[0]?.headers['range']).toBe('bytes=0-1023');
  });

  it('returns the right bytes for a mid-file range', async () => {
    const res = await raw(`${h.base}/media?${u('/media')}`, {
      headers: { range: 'bytes=500000-500099' },
    });
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 500000-500099/${MEDIA.length}`);
    expect(res.body.equals(MEDIA.subarray(500000, 500100))).toBe(true);
  });

  it('forwards If-Range unchanged', async () => {
    await raw(`${h.base}/media?${u('/media')}`, {
      headers: { range: 'bytes=0-9', 'if-range': '"etag-value"' },
    });
    expect(received[0]?.headers['if-range']).toBe('"etag-value"');
  });

  it('streams a full 1 MiB body byte-for-byte when no Range is sent', async () => {
    const res = await raw(`${h.base}/media?${u('/media')}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(MEDIA.length);
    expect(res.body.equals(MEDIA)).toBe(true);
    expect(received[0]?.headers['range']).toBeUndefined();
  });

  it('mirrors 403 and 416 intact', async () => {
    const forbidden = await raw(`${h.base}/media?${u('/forbidden')}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.toString()).toBe('forbidden');

    const unsatisfiable = await raw(`${h.base}/media?${u('/media')}`, {
      headers: { range: `bytes=${MEDIA.length + 10}-` },
    });
    expect(unsatisfiable.status).toBe(416);
    expect(unsatisfiable.headers['content-range']).toBe(`bytes */${MEDIA.length}`);
  });

  it('adds CORS headers scoped to the renderer origin', async () => {
    const res = await raw(`${h.base}/media?${u('/media')}`, { headers: { range: 'bytes=0-9' } });
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-expose-headers']).toBe(
      'Content-Range, Content-Length, Accept-Ranges',
    );
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('proxy server — header hygiene', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ routes: TEST_ROUTES });
  });
  afterAll(async () => {
    await h.close();
  });

  it('never forwards Origin, Referer, Cookie or Authorization upstream', async () => {
    await raw(`${h.base}/media?${u('/media')}`, {
      headers: {
        origin: ORIGIN,
        referer: 'app://bundle/watch',
        cookie: 'session=secret',
        authorization: 'Bearer secret',
        'user-agent': 'LuneTube/0.1.0 Electron',
        'x-custom': 'nope',
      },
    });

    const upstream = received[0]?.headers ?? {};
    expect(upstream['origin']).toBeUndefined();
    expect(upstream['referer']).toBeUndefined();
    expect(upstream['cookie']).toBeUndefined();
    expect(upstream['authorization']).toBeUndefined();
    expect(upstream['user-agent']).toBeUndefined();
    expect(upstream['x-custom']).toBeUndefined();
    expect(upstream['accept-encoding']).toBe('identity');
  });

  it('never mirrors Set-Cookie back to the renderer', async () => {
    const res = await raw(`${h.base}/img?${u('/img.jpg')}`);
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

describe('proxy server — redirects', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ routes: TEST_ROUTES });
  });
  afterAll(async () => {
    await h.close();
  });

  it('follows a redirect that stays inside the allow-list', async () => {
    const res = await raw(`${h.base}/media?${u('/redirect')}`, {
      headers: { range: 'bytes=0-99' },
    });
    expect(res.status).toBe(206);
    expect(res.body.equals(MEDIA.subarray(0, 100))).toBe(true);
    // The Range survived the hop.
    expect(received[1]?.headers['range']).toBe('bytes=0-99');
  });

  it('refuses a redirect that leaves the allow-list', async () => {
    const res = await raw(`${h.base}/media?${u('/redirect-offsite')}`);
    expect(res.status).toBe(502);
    // Exactly one upstream request: the hop to 169.254.169.254 never happened.
    expect(received).toHaveLength(1);
  });

  it('caps redirect depth', async () => {
    const res = await raw(`${h.base}/media?${u('/redirect-loop')}`);
    expect(res.status).toBe(502);
    expect(received.length).toBeLessThanOrEqual(4);
  });
});

describe('proxy server — target rejection', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ routes: TEST_ROUTES });
  });
  afterAll(async () => {
    await h.close();
  });

  it('rejects a missing, unparseable or disallowed u parameter with 400', async () => {
    const cases = [
      '',
      'u=',
      'u=!!!!',
      `u=${encodeTargetParam('https://evil.com/')}`,
      `u=${encodeTargetParam('file:///etc/passwd')}`,
      `u=${encodeTargetParam('//127.0.0.1/media')}`,
      `u=${encodeTargetParam(`https://127.0.0.1:${originPort}/media`)}`, // scheme not allowed
    ];
    for (const query of cases) {
      const res = await raw(`${h.base}/media?${query}`);
      expect(res.status).toBe(400);
    }
    expect(received).toHaveLength(0);
  });

  it('enforces the per-route pathname rule', async () => {
    expect((await raw(`${h.base}/caption?${u('/caption')}`)).status).toBe(200);
    expect((await raw(`${h.base}/caption?${u('/media')}`)).status).toBe(400);
  });
});

describe('proxy server — /img disk cache', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ routes: TEST_ROUTES, cacheBytes: 1024 * 1024 });
  });
  afterAll(async () => {
    await h.close();
  });

  it('serves the second request from disk without hitting upstream', async () => {
    const first = await raw(`${h.base}/img?${u('/img.jpg')}`);
    expect(first.status).toBe(200);
    expect(first.body.equals(JPEG)).toBe(true);

    // The cache write rides alongside the response; wait for it to land.
    await expect.poll(() => h.cache?.entryCount ?? 0, { timeout: 2000 }).toBeGreaterThanOrEqual(1);

    received = [];
    const second = await raw(`${h.base}/img?${u('/img.jpg')}`);
    expect(second.status).toBe(200);
    expect(second.body.equals(JPEG)).toBe(true);
    expect(second.headers['content-type']).toBe('image/jpeg');
    expect(second.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(received).toHaveLength(0);
  });

  it('names entries by sha256 of the target URL and commits atomically', async () => {
    await raw(`${h.base}/img?${u('/img2.jpg')}`);
    await expect.poll(() => h.cache?.entryCount ?? 0, { timeout: 2000 }).toBeGreaterThanOrEqual(2);

    const names = await readdir(h.cacheDir ?? '.');
    expect(names).toContain(`${cacheKey(originUrl('/img2.jpg'))}.jpg`);
    // No temp files survive a successful write.
    expect(names.some((n) => n.endsWith('.tmp'))).toBe(false);
  });

  it('does not cache a non-image content type', async () => {
    const before = h.cache?.entryCount ?? 0;
    const res = await raw(`${h.base}/img?${u('/img.html')}`);
    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(h.cache?.entryCount ?? 0).toBe(before);
  });

  it('does not forward Range on /img (a cache entry is always whole)', async () => {
    received = [];
    await raw(`${h.base}/img?${u('/img.html')}`, { headers: { range: 'bytes=0-9' } });
    expect(received[0]?.headers['range']).toBeUndefined();
  });
});

describe('ImageCache — LRU eviction and concurrency', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lunetube-cache-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const body = (bytes: number): Readable => Readable.from([Buffer.alloc(bytes, 1)]);

  it('evicts the least recently used entry once over cap', async () => {
    const cache = new ImageCache({ dir, maxBytes: 2500 });
    await cache.ready();

    expect(await cache.store('a'.repeat(64), 'image/jpeg', body(1000))).toBe(true);
    expect(await cache.store('b'.repeat(64), 'image/png', body(1000))).toBe(true);
    // Touch `a` so `b` becomes the LRU victim.
    await cache.lookup('a'.repeat(64));
    expect(await cache.store('c'.repeat(64), 'image/webp', body(1000))).toBe(true);

    expect(cache.totalBytes).toBeLessThanOrEqual(2500);
    expect(await cache.lookup('b'.repeat(64))).toBeNull();
    expect(await cache.lookup('a'.repeat(64))).not.toBeNull();
    expect(await cache.lookup('c'.repeat(64))).not.toBeNull();
  });

  it('refuses a truncated body and leaves no temp file behind', async () => {
    const cache = new ImageCache({ dir, maxBytes: 100_000 });
    await cache.ready();
    const key = 'd'.repeat(64);
    // Declares 5000 bytes but delivers 10.
    expect(await cache.store(key, 'image/jpeg', body(10), 5000)).toBe(false);
    expect(await cache.lookup(key)).toBeNull();
    const names = await readdir(dir);
    expect(names.some((n) => n.startsWith(key))).toBe(false);
  });

  it('tolerates concurrent writes of the same key', async () => {
    const cache = new ImageCache({ dir, maxBytes: 100_000 });
    await cache.ready();
    const key = 'e'.repeat(64);
    const results = await Promise.all([
      cache.store(key, 'image/jpeg', body(2048)),
      cache.store(key, 'image/jpeg', body(2048)),
      cache.store(key, 'image/jpeg', body(2048)),
    ]);
    expect(results.every(Boolean)).toBe(true);
    const hit = await cache.lookup(key);
    expect(hit?.size).toBe(2048);
    const names = await readdir(dir);
    expect(names.filter((n) => n.startsWith(key))).toEqual([`${key}.jpg`]);
  });

  it('does not orphan or double-count a file when the content type changes (F8)', async () => {
    const keyDir = await mkdtemp(join(tmpdir(), 'lunetube-cache-ext-'));
    try {
      const key = '0'.repeat(64);
      const cache = new ImageCache({ dir: keyDir, maxBytes: 100_000 });
      await cache.ready();

      expect(await cache.store(key, 'image/jpeg', body(1000))).toBe(true);
      // Same URL, now served as webp — the old `.jpg` must go.
      expect(await cache.store(key, 'image/webp', body(1500))).toBe(true);

      expect(cache.totalBytes).toBe(1500);
      // The stale `<key>.jpg` is unlinked best-effort and unawaited by
      // `#remember` ("a failure must not fail the store"), so under load it can
      // still be on disk the instant `store()` resolves. The accounting above is
      // already correct; poll for the filesystem to catch up (P2-11, test-only).
      await expect
        .poll(async () => (await readdir(keyDir)).filter((n) => n.startsWith(key)), {
          timeout: 2000,
        })
        .toEqual([`${key}.webp`]);

      // A fresh instance scanning the directory must also count it exactly once.
      const reopened = new ImageCache({ dir: keyDir, maxBytes: 100_000 });
      await reopened.ready();
      expect(reopened.totalBytes).toBe(1500);
    } finally {
      await rm(keyDir, { recursive: true, force: true });
    }
  });

  it('collapses a stale duplicate left by an earlier run on scan (F8)', async () => {
    const keyDir = await mkdtemp(join(tmpdir(), 'lunetube-cache-dup-'));
    try {
      const key = '1'.repeat(64);
      // Two files for one key, as a pre-fix build could have left behind.
      await writeFile(join(keyDir, `${key}.jpg`), Buffer.alloc(1000, 1));
      await new Promise((r) => setTimeout(r, 10));
      await writeFile(join(keyDir, `${key}.webp`), Buffer.alloc(1500, 1));

      const cache = new ImageCache({ dir: keyDir, maxBytes: 100_000 });
      await cache.ready();

      expect(cache.totalBytes).toBe(1500); // newest only, counted once
      expect((await readdir(keyDir)).filter((n) => n.startsWith(key))).toEqual([`${key}.webp`]);
    } finally {
      await rm(keyDir, { recursive: true, force: true });
    }
  });

  it('is disabled when maxBytes is 0', async () => {
    const cache = new ImageCache({ dir, maxBytes: 0 });
    expect(await cache.store('f'.repeat(64), 'image/jpeg', body(10))).toBe(false);
    expect(await cache.lookup('f'.repeat(64))).toBeNull();
  });
});

describe('proxy server — the shipped (production) route table', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness(); // no `routes` override ⇒ PRODUCTION_ROUTES
  });
  afterAll(async () => {
    await h.close();
  });

  it('rejects a loopback target on every route', async () => {
    for (const route of ['media', 'img', 'caption']) {
      const res = await raw(`${h.base}/${route}?${u('/media')}`);
      expect(res.status).toBe(400);
    }
    expect(received).toHaveLength(0);
  });

  it('rejects the classic suffix-confusion host', async () => {
    const target = encodeTargetParam('https://googlevideo.com.evil.example/videoplayback');
    expect((await raw(`${h.base}/media?u=${target}`)).status).toBe(400);
  });

  it('still rejects a wrong token first', async () => {
    const bad = h.base.replace(TOKEN, 'c'.repeat(64));
    expect((await raw(`${bad}/media?${u('/media')}`)).status).toBe(404);
  });
});
