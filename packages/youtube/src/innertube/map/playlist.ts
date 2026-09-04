/**
 * `Playlist` → `PlaylistDetail`. Pure — no I/O, no `youtubei.js` import.
 *
 * Two throw hazards this file exists to route around (P2-F6, both handled
 * defensively here even though the *end-of-list* one is primarily `source.ts`'s
 * job to catch before a `Playlist` object ever reaches this mapper):
 *
 *  1. The `Playlist` constructor throws `'Got empty continuation response...'`
 *     on the last page — `source.ts#getPlaylist` catches that around the
 *     `getContinuation()` call and never calls this mapper for that case.
 *  2. `Playlist.items` is a *getter* that calls `ObservedArray.as(...)`, which
 *     throws `ParsingError` on an unknown node type (`Playlist.js:72`). Reading
 *     it is wrapped here and falls back to the memo-based, non-throwing
 *     `Feed.videos`.
 */
import type { ChannelRef, PlaylistDetail } from '@lunetube/shared';
import type { RawThumbnail } from './thumbnail.js';
import { nonEmpty, parseHumanCount, textToString, type MaybeText } from './util.js';
import { mapFeedVideos, thumbUrl, type ImageRewriter, type RawFeedVideoNode } from './video.js';

/** `Author` (`misc/Author.js`) as read off `Playlist.info.author`. */
interface RawAuthor {
  id?: unknown;
  name?: unknown;
  thumbnails?: RawThumbnail[] | null;
}

/**
 * `Playlist.info` — spread from `PlaylistMetadata` plus the header-derived
 * extras the constructor computes (`title`/`description` from the former,
 * everything else from `PlaylistHeader` / `PlaylistSidebar*`). Absent
 * entirely on a continuation response, which carries no header at all
 * (plan P2-4) — every field below degrades to empty/`null` in that case.
 */
export interface RawPlaylistInfo {
  title?: unknown;
  description?: unknown;
  author?: RawAuthor | null;
  thumbnails?: RawThumbnail[] | null;
  total_items?: unknown;
  views?: unknown;
  last_updated?: unknown;
}

export interface RawPlaylist {
  info?: RawPlaylistInfo | null;
}

/** `Playlist.info`'s numeric stats fall back to the literal string `'N/A'` — treat it as absent. */
function stat(value: unknown): string | null {
  const s = nonEmpty(value as MaybeText);
  return s === 'N/A' ? null : s;
}

function mapAuthor(
  author: RawAuthor | null | undefined,
  rewriteImage?: ImageRewriter,
): ChannelRef | null {
  if (author == null) return null;
  const id = typeof author.id === 'string' ? author.id : '';
  const name = nonEmpty(author.name as MaybeText) ?? '';
  if (id.length === 0 && name.length === 0) return null;
  return { id, name, avatarUrl: thumbUrl(author.thumbnails, rewriteImage, { maxWidth: 176 }) };
}

/**
 * `Playlist.items` (throws `ParsingError` on an unknown node type) with a
 * fallback to `Playlist.videos` (memo-based, never throws) — P2-F6 #4.
 */
function playlistItemNodes(pl: unknown): unknown[] {
  try {
    const items = (pl as { items?: unknown } | null)?.items;
    if (Array.isArray(items)) return items;
  } catch {
    // ObservedArray.as(...) hit an unknown node type — fall through to `videos`.
  }
  const videos = (pl as { videos?: unknown } | null)?.videos;
  return Array.isArray(videos) ? videos : [];
}

/**
 * `Playlist` / `ChannelListContinuation`-shaped continuation response →
 * `PlaylistDetail`. `playlistId` is the request's own id, since a continuation
 * response's `info` is undefined and carries no id of its own. `continuation`
 * is **not** set here — `source.ts` owns minting it from `has_continuation`.
 */
export function mapPlaylistDetail(
  pl: unknown,
  playlistId: string,
  rewriteImage?: ImageRewriter,
): PlaylistDetail {
  const info = (pl as RawPlaylist | null)?.info ?? null;
  const items = mapFeedVideos(playlistItemNodes(pl) as RawFeedVideoNode[], rewriteImage);

  return {
    id: playlistId,
    title: nonEmpty(info?.title as MaybeText) ?? '',
    thumbnailUrl: thumbUrl(info?.thumbnails, rewriteImage),
    videoCount: parseHumanCount(stat(info?.total_items)),
    description: textToString(info?.description as MaybeText),
    author: mapAuthor(info?.author, rewriteImage),
    lastUpdatedText: stat(info?.last_updated),
    items,
  };
}
