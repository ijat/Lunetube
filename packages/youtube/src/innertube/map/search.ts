/**
 * Search: `SearchFilters` (our DTO) → youtubei.js' string-union filter shape, and
 * a `Search` feed → `SearchPage`. Pure — no I/O, no `youtubei.js`; dispatch on
 * the readonly `node.type` string (P2-F5).
 *
 * The highest-churn surface in the app. **Unknown node types are skipped, not
 * errors** — a lost row is always better than a thrown page (plan R2-1). Every
 * per-kind mapper (`mapFeedVideo` / `mapChannelCard` / `mapPlaylistRef`) already
 * degrades to a partial DTO rather than throwing.
 */
import type { SearchFilters, SearchResultItem } from '@lunetube/shared';
import { mapChannelCard, mapPlaylistRef, type RawCardNode } from './cards.js';
import { mapFeedVideo, type ImageRewriter, type RawFeedVideoNode } from './video.js';
import { toNumberOrNull } from './util.js';

/**
 * youtubei.js' `SearchFilters` (from `types/Misc.d.ts`) — string unions, **not**
 * our DTO. Every key is optional; the encoder skips `undefined`
 * (`protos/generated/misc/params.js`). P2-F3: never send `'all'` — omit the key.
 */
export interface InnertubeSearchFilters {
  upload_date?: 'today' | 'week' | 'month' | 'year';
  type?: 'video' | 'channel' | 'playlist';
  duration?: 'under_three_mins' | 'three_to_twenty_mins' | 'over_twenty_mins';
  prioritize?: 'relevance' | 'popularity';
}

/**
 * `SearchFilters` → InnerTube filter object. `sort` maps to `prioritize`
 * (`views → popularity`, `relevance → relevance`); every `'any'` / `'all'`
 * selection **omits its key** rather than sending `'all'` (P2-F3 / A14).
 */
export function toInnertubeFilters(f: SearchFilters): InnertubeSearchFilters {
  const out: InnertubeSearchFilters = {
    prioritize: f.sort === 'views' ? 'popularity' : 'relevance',
  };
  if (f.uploadDate !== 'any') out.upload_date = f.uploadDate;
  if (f.duration === 'short') out.duration = 'under_three_mins';
  else if (f.duration === 'medium') out.duration = 'three_to_twenty_mins';
  else if (f.duration === 'long') out.duration = 'over_twenty_mins';
  if (f.type !== 'all') out.type = f.type;
  return out;
}

/** Structural view of a youtubei.js `Search` feed. */
export interface RawSearch {
  results?: unknown;
  estimated_results?: unknown;
}

const VIDEO_TYPES = new Set([
  'Video',
  'CompactVideo',
  'GridVideo',
  'ReelItem',
  'PlaylistVideo',
  'PlaylistPanelVideo',
  'WatchCardCompactVideo',
  'ShortsLockupView',
]);
const CHANNEL_TYPES = new Set(['Channel', 'GridChannel']);
const PLAYLIST_TYPES = new Set(['GridPlaylist', 'Playlist']);
const SHELF_TYPES = new Set([
  'Shelf',
  'ReelShelf',
  'RichShelf',
  'ItemSection',
  'HorizontalCardList',
]);

type RawNode = Record<string, unknown> & { type?: unknown; content_type?: unknown };

function nodeType(node: RawNode): string {
  return typeof node.type === 'string' ? node.type : '';
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** One level of shelf flattening — `items` / `contents` / `content.*`, unwrapping `RichItem`. */
function shelfChildren(node: RawNode): RawNode[] {
  const content = node['content'];
  const c =
    content != null && typeof content === 'object' ? (content as Record<string, unknown>) : {};
  const raw = [
    ...asArray(node['items']),
    ...asArray(node['contents']),
    ...asArray(c['items']),
    ...asArray(c['contents']),
  ];
  return raw
    .map((it): RawNode | null => {
      if (it == null || typeof it !== 'object') return null;
      const inner = (it as Record<string, unknown>)['content'];
      return inner != null && typeof inner === 'object' ? (inner as RawNode) : (it as RawNode);
    })
    .filter((n): n is RawNode => n != null);
}

function classify(node: RawNode): 'video' | 'channel' | 'playlist' | null {
  const type = nodeType(node);
  if (type === 'LockupView') {
    const ct = typeof node.content_type === 'string' ? node.content_type : '';
    if (ct === 'VIDEO' || ct === 'SHORT') return 'video';
    if (ct === 'PLAYLIST' || ct === 'PLAYLIST_UPDATE' || ct === 'ALBUM') return 'playlist';
    if (ct === 'CHANNEL') return 'channel';
    return null;
  }
  if (VIDEO_TYPES.has(type)) return 'video';
  if (CHANNEL_TYPES.has(type)) return 'channel';
  if (PLAYLIST_TYPES.has(type)) return 'playlist';
  return null;
}

function mapNode(node: RawNode, rewriteImage: ImageRewriter | undefined): SearchResultItem | null {
  switch (classify(node)) {
    case 'video': {
      const video = mapFeedVideo(node as RawFeedVideoNode, rewriteImage);
      return video != null ? { kind: 'video', video } : null;
    }
    case 'channel': {
      const channel = mapChannelCard(node as RawCardNode, rewriteImage);
      return channel != null ? { kind: 'channel', channel } : null;
    }
    case 'playlist': {
      const playlist = mapPlaylistRef(node as RawCardNode, rewriteImage);
      return playlist != null ? { kind: 'playlist', playlist } : null;
    }
    default:
      return null;
  }
}

/**
 * `Search.results` → `SearchResultItem[]` plus `estimatedResults`. `Shelf` /
 * `ReelShelf` / `RichShelf` are flattened one level; a shelf we can't flatten is
 * skipped, an unknown leaf node is skipped.
 */
export function mapSearchPage(
  search: RawSearch,
  rewriteImage?: ImageRewriter,
): { items: SearchResultItem[]; estimatedResults: number | null } {
  const results = Array.isArray(search.results) ? (search.results as RawNode[]) : [];
  const items: SearchResultItem[] = [];

  for (const node of results) {
    if (node == null || typeof node !== 'object') continue;
    if (SHELF_TYPES.has(nodeType(node))) {
      for (const child of shelfChildren(node)) {
        const mapped = mapNode(child, rewriteImage);
        if (mapped != null) items.push(mapped);
      }
      continue;
    }
    const mapped = mapNode(node, rewriteImage);
    if (mapped != null) items.push(mapped);
  }

  return { items, estimatedResults: toNumberOrNull(search.estimated_results) };
}
