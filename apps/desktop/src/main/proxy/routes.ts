import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import {
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from 'node:http';
import { request as httpsRequest } from 'node:https';
import { PassThrough, pipeline } from 'node:stream';
import { resolveRedirect, type RouteRule } from './allowlist.js';
import { cacheKey, type ImageCache } from './imageCache.js';

/**
 * The three proxy routes (plan Architecture → "The media proxy").
 *
 * Two invariants hold across all of them:
 *
 * 1. **Requests to upstream are built from an explicit allow-list of headers,
 *    never by copying and deleting.** `Origin`, `Referer`, `Cookie` and
 *    `Authorization` are not stripped so much as never constructed — there is
 *    no code path that can put a renderer header onto the upstream request. A
 *    deny-list would silently start leaking the day a new header appears.
 * 2. **Responses are mirrored through an explicit allow-list too**, so an
 *    upstream `Set-Cookie` can never reach the renderer.
 */

/** Upstream response headers passed back to the renderer verbatim. */
const MIRRORED_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  // Mirrored for correctness only: we always ask for `identity`, but if an
  // upstream ignores that, the body is encoded and the renderer must be told.
  'content-encoding',
] as const;

/** Per the plan: what the renderer's `fetch`/XHR is allowed to read back. */
export const EXPOSED_HEADERS = 'Content-Range, Content-Length, Accept-Ranges';

/** Kills a stalled upstream socket. Inactivity, not total duration — a long 4K
 * segment download must not be cut off just for being long. */
const UPSTREAM_IDLE_TIMEOUT_MS = 30_000;

export const DEFAULT_MAX_REDIRECTS = 3;

/** An upstream failure that maps to a specific status for the renderer. */
export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export interface RouteContext {
  readonly rule: RouteRule;
  readonly target: URL;
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  /** CORS headers scoped to the renderer origin; added to every proxied response. */
  readonly cors: Readonly<Record<string, string>>;
  readonly imageCache: ImageCache | null;
  readonly maxRedirects: number;
  readonly signal: AbortSignal;
}

interface Upstream {
  readonly request: ClientRequest;
  readonly response: IncomingMessage;
  readonly url: URL;
}

/**
 * Builds the upstream request headers. This is the whole set — nothing from
 * `req.headers` reaches upstream except a range, and only where the route
 * wants one.
 */
export function upstreamHeaders(
  req: IncomingMessage,
  options: { forwardRange: boolean },
): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = { 'accept-encoding': 'identity' };
  if (!options.forwardRange) return headers;

  const range = req.headers['range'];
  if (typeof range === 'string') headers['range'] = range;
  const ifRange = req.headers['if-range'];
  if (typeof ifRange === 'string') headers['if-range'] = ifRange;
  return headers;
}

/** Mirrors only `MIRRORED_HEADERS` from the upstream response. */
export function mirrorHeaders(response: IncomingMessage): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  for (const name of MIRRORED_HEADERS) {
    const value = response.headers[name];
    if (typeof value === 'string') out[name] = value;
  }
  return out;
}

function send(
  url: URL,
  headers: OutgoingHttpHeaders,
  signal: AbortSignal,
): Promise<{ request: ClientRequest; response: IncomingMessage }> {
  const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const request = transport(url, { method: 'GET', headers, signal }, (response) => {
      resolve({ request, response });
    });
    request.setTimeout(UPSTREAM_IDLE_TIMEOUT_MS, () => {
      request.destroy(new UpstreamError(504, 'upstream timed out'));
    });
    request.on('error', reject);
    request.end();
  });
}

/**
 * Performs the upstream GET, following redirects **only** to targets that
 * satisfy the very same route rule that admitted the original URL. This is the
 * second half of the SSRF guarantee: without it, an allow-listed host could
 * bounce the proxy anywhere just by answering `302 Location: http://169.254.169.254/`.
 */
export async function fetchAllowed(
  start: URL,
  rule: RouteRule,
  headers: OutgoingHttpHeaders,
  signal: AbortSignal,
  maxRedirects: number,
): Promise<Upstream> {
  let current = start;
  for (let hop = 0; ; hop += 1) {
    const { request, response } = await send(current, headers, signal);
    const status = response.statusCode ?? 0;
    const location = response.headers['location'];

    // 304 and 300/305/306 have no usable `Location`; the type guard covers them.
    if (status >= 300 && status < 400 && typeof location === 'string') {
      response.resume();
      request.destroy();
      if (hop >= maxRedirects) throw new UpstreamError(502, 'too many upstream redirects');
      const next = resolveRedirect(location, current, rule);
      if (next === null) throw new UpstreamError(502, 'upstream redirect left the allow-list');
      current = next;
      continue;
    }

    return { request, response, url: current };
  }
}

/** Pipes an upstream body to the renderer and tears down the socket on failure. */
function relayBody(upstream: Upstream, res: ServerResponse): void {
  pipeline(upstream.response, res, (error) => {
    // A client abort (a seek, a track switch) lands here. Destroying the
    // upstream request is what stops us from pulling bytes we will throw away.
    if (error) upstream.request.destroy();
  });
}

/**
 * `/media` — ranged, streamed, never buffered and never cached. The upstream
 * status is mirrored exactly: shaka's error handling depends on seeing 206 vs
 * 403 vs 416, and collapsing them to 200/500 would break the P1-5 recovery loop.
 */
export async function handleMedia(ctx: RouteContext): Promise<void> {
  const upstream = await fetchAllowed(
    ctx.target,
    ctx.rule,
    upstreamHeaders(ctx.req, { forwardRange: true }),
    ctx.signal,
    ctx.maxRedirects,
  );

  ctx.res.writeHead(upstream.response.statusCode ?? 502, {
    ...mirrorHeaders(upstream.response),
    ...ctx.cors,
    'cache-control': 'no-store',
  });
  relayBody(upstream, ctx.res);
}

/**
 * `/caption` — small text bodies from the timedtext endpoint. Same mirroring
 * rules as `/media`, no range, no disk cache.
 */
export async function handleCaption(ctx: RouteContext): Promise<void> {
  const upstream = await fetchAllowed(
    ctx.target,
    ctx.rule,
    upstreamHeaders(ctx.req, { forwardRange: false }),
    ctx.signal,
    ctx.maxRedirects,
  );

  ctx.res.writeHead(upstream.response.statusCode ?? 502, {
    ...mirrorHeaders(upstream.response),
    ...ctx.cors,
    'cache-control': 'no-store',
  });
  relayBody(upstream, ctx.res);
}

const IMAGE_CACHE_CONTROL = 'private, max-age=86400';

/**
 * `/img` — thumbnails, avatars and storyboard sheets, backed by the
 * content-addressed disk cache (PRD §9). Range is deliberately *not* forwarded:
 * a cache entry is only meaningful if it is the whole resource, so this route
 * always asks upstream for the full body and always answers 200.
 *
 * Routing images through the proxy is also what makes them same-origin for the
 * renderer, which is what lets P1-6 read thumbnail pixels off a canvas without
 * tainting it.
 */
export async function handleImage(ctx: RouteContext): Promise<void> {
  const cache = ctx.imageCache;
  const key = cacheKey(ctx.target.href);

  if (cache !== null) {
    const served = await serveFromCache(ctx, cache, key);
    if (served) return;
  }

  const upstream = await fetchAllowed(
    ctx.target,
    ctx.rule,
    upstreamHeaders(ctx.req, { forwardRange: false }),
    ctx.signal,
    ctx.maxRedirects,
  );

  const status = upstream.response.statusCode ?? 502;
  ctx.res.writeHead(status, {
    ...mirrorHeaders(upstream.response),
    ...ctx.cors,
    'cache-control': status === 200 ? IMAGE_CACHE_CONTROL : 'no-store',
  });

  if (cache !== null && status === 200) {
    const encoding = upstream.response.headers['content-encoding'];
    // Only ever cache an identity-encoded body: the cache serves entries back
    // without a `Content-Encoding`, so storing compressed bytes would hand the
    // renderer an undecodable image.
    if (encoding === undefined || encoding === 'identity') {
      const branch = new PassThrough();
      upstream.response.on('error', (error) => branch.destroy(error));
      // `pipe` forwards neither errors nor destroys. Without this, a client
      // that aborts mid-download leaves the cache write hanging on a stream
      // that will never end, holding its temp file open until process exit.
      upstream.response.on('close', () => {
        if (!upstream.response.complete) branch.destroy(new Error('upstream closed early'));
      });
      upstream.response.pipe(branch);

      const declared = Number(upstream.response.headers['content-length']);
      void cache.store(
        key,
        upstream.response.headers['content-type'],
        branch,
        Number.isFinite(declared) ? declared : undefined,
      );
    }
  }

  relayBody(upstream, ctx.res);
}

/**
 * Returns `true` when the response was fully served from disk. Opening the file
 * is awaited *before* the status line is written, so a vanished entry degrades
 * to a normal upstream fetch instead of a truncated 200.
 */
async function serveFromCache(ctx: RouteContext, cache: ImageCache, key: string): Promise<boolean> {
  const hit = await cache.lookup(key);
  if (hit === null) return false;

  const stream = createReadStream(hit.path);
  try {
    await once(stream, 'open');
  } catch {
    stream.destroy();
    return false;
  }

  ctx.res.writeHead(200, {
    'content-type': hit.contentType,
    'content-length': String(hit.size),
    'accept-ranges': 'none',
    ...ctx.cors,
    'cache-control': IMAGE_CACHE_CONTROL,
  });
  pipeline(stream, ctx.res, () => undefined);
  return true;
}
