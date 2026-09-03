import { createHash, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse,
} from 'node:http';
import {
  isRouteName,
  PRODUCTION_ROUTES,
  resolveTarget,
  type RouteName,
  type RouteRule,
} from './allowlist.js';
import type { ImageCache } from './imageCache.js';
import {
  DEFAULT_MAX_REDIRECTS,
  EXPOSED_HEADERS,
  handleCaption,
  handleImage,
  handleMedia,
  UpstreamError,
  type RouteContext,
} from './routes.js';

/**
 * The loopback HTTP server itself. Request admission is deliberately ordered so
 * that the cheapest, least-attackable checks run first and **no attacker-supplied
 * URL is parsed until the per-launch token has been verified**:
 *
 *   1. method  →  2. raw path split  →  3. constant-time token compare
 *   →  4. Host header  →  5. route name  →  6. target decode + allow-list
 *
 * Step 3 is a `timingSafeEqual` over SHA-256 digests rather than over the token
 * bytes directly. Digests are always 32 bytes, so a candidate of the wrong
 * length is compared in constant time too — `timingSafeEqual` throws on a
 * length mismatch, and a length pre-check would itself be an early-exit oracle.
 *
 * Step 4 is anti-DNS-rebinding defence in depth: the server is already bound to
 * `127.0.0.1`, and the token is 256 bits, but requiring a loopback `Host` costs
 * nothing and closes the "hostile page resolves its own name to 127.0.0.1" path
 * regardless.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export interface ProxyServerConfig {
  /** Per-launch path token; see `index.ts`. */
  readonly token: string;
  /** Renderer origin (`app://bundle` in prod, the dev server origin in dev). */
  readonly allowedOrigin: string;
  /**
   * Route table. Defaults to `PRODUCTION_ROUTES`. Overridable **only** so the
   * integration tests can point a route at a local fixture origin; `index.ts`,
   * the sole entry point for the rest of main, does not expose this.
   */
  readonly routes?: Readonly<Record<RouteName, RouteRule>>;
  readonly imageCache?: ImageCache | null;
  readonly maxRedirects?: number;
}

function respond(
  res: ServerResponse,
  status: number,
  message: string,
  headers: OutgoingHttpHeaders = {},
): void {
  const body = Buffer.from(`${message}\n`, 'utf8');
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

/** Hostname portion of a `Host` header, port stripped, IPv6 brackets kept. */
function hostnameOf(hostHeader: string): string {
  if (hostHeader.startsWith('[')) {
    const end = hostHeader.indexOf(']');
    return end === -1 ? hostHeader : hostHeader.slice(0, end + 1);
  }
  const colon = hostHeader.indexOf(':');
  return colon === -1 ? hostHeader : hostHeader.slice(0, colon);
}

export function createProxyServer(config: ProxyServerConfig): Server {
  const routes = config.routes ?? PRODUCTION_ROUTES;
  const imageCache = config.imageCache ?? null;
  const maxRedirects = config.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const tokenDigest = createHash('sha256').update(config.token, 'utf8').digest();

  const cors: Readonly<Record<string, string>> = {
    'access-control-allow-origin': config.allowedOrigin,
    'access-control-expose-headers': EXPOSED_HEADERS,
  };

  function tokenMatches(candidate: string): boolean {
    const candidateDigest = createHash('sha256').update(candidate, 'utf8').digest();
    return timingSafeEqual(tokenDigest, candidateDigest);
  }

  async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'OPTIONS') {
      respond(res, 405, 'Method Not Allowed', { allow: 'GET, OPTIONS' });
      return;
    }

    // Raw string handling only — no URL parsing of anything attacker-controlled
    // before the token has been checked.
    const rawUrl = req.url ?? '';
    const queryAt = rawUrl.indexOf('?');
    const rawPath = queryAt === -1 ? rawUrl : rawUrl.slice(0, queryAt);
    const segments = rawPath.split('/');

    // `/<token>/<route>` → ['', token, route]
    const token = segments.length === 3 ? segments[1] : undefined;
    const routeSegment = segments.length === 3 ? segments[2] : undefined;

    if (token === undefined || !tokenMatches(token)) {
      respond(res, 404, 'Not Found');
      return;
    }

    const hostHeader = req.headers['host'];
    if (typeof hostHeader !== 'string' || !LOOPBACK_HOSTS.has(hostnameOf(hostHeader))) {
      respond(res, 400, 'Bad Request');
      return;
    }

    if (routeSegment === undefined || !isRouteName(routeSegment)) {
      respond(res, 404, 'Not Found', cors);
      return;
    }
    const rule = routes[routeSegment];

    if (req.method === 'OPTIONS') {
      // CORS preflight. Answered entirely locally — it never touches upstream,
      // so it adds no request-forgery surface.
      res.writeHead(204, {
        ...cors,
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': 'Range, If-Range',
        'access-control-max-age': '600',
        'content-length': '0',
      });
      res.end();
      return;
    }

    const query = new URLSearchParams(queryAt === -1 ? '' : rawUrl.slice(queryAt + 1));
    const target = resolveTarget(query.get('u'), rule);
    if (target === null) {
      // One response for every rejection reason — a decode failure, a bad
      // scheme and a disallowed host are indistinguishable from outside.
      respond(res, 400, 'Bad Request', cors);
      return;
    }

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    const ctx: RouteContext = {
      rule,
      target,
      req,
      res,
      cors,
      imageCache,
      maxRedirects,
      signal: controller.signal,
    };

    switch (routeSegment) {
      case 'media':
        await handleMedia(ctx);
        return;
      case 'img':
        await handleImage(ctx);
        return;
      case 'caption':
        await handleCaption(ctx);
        return;
    }
  }

  const server = createServer((req, res) => {
    dispatch(req, res).catch((error: unknown) => {
      // The client hung up mid-flight: nothing left to answer.
      if (res.writableEnded || res.destroyed) return;
      if (error instanceof Error && error.name === 'AbortError') {
        res.destroy();
        return;
      }
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const status = error instanceof UpstreamError ? error.status : 502;
      respond(res, status, 'Bad Gateway', cors);
    });
  });

  // A malformed request line must not take the process down.
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
  });

  return server;
}
