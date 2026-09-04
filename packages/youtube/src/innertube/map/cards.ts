/**
 * The non-video card node shapes → `@lunetube/shared` DTOs. Pure — no I/O, no
 * `youtubei.js` import; dispatch on the readonly `node.type` string (P2-F5).
 *
 * Same defensive contract as `map/video.ts`: every field is read best-effort, a
 * missing or renamed key yields a partial DTO rather than a throw, and the
 * mapper returns `null` only when there is no resolvable id.
 */
import type { ChannelDetail, ChannelRef, PlaylistRef } from '@lunetube/shared';
import type { RawThumbnail } from './thumbnail.js';
import { nonEmpty, parseHumanCount, textToString, type MaybeText } from './util.js';
import { thumbUrl, type ImageRewriter } from './video.js';

interface RawAuthorLike {
  id?: unknown;
  name?: unknown;
  thumbnails?: RawThumbnail[] | null;
  is_verified?: unknown;
}

/**
 * Union of the card node shapes: `Playlist` / `GridPlaylist` / `Channel` /
 * `GridChannel`, plus the `LockupView` variants with `content_type` `PLAYLIST`
 * or `CHANNEL`.
 */
export interface RawCardNode {
  type?: unknown;
  id?: unknown;
  content_id?: unknown;
  content_type?: unknown;
  title?: MaybeText;
  /** `LockupView.metadata.title`. */
  metadata?: { title?: MaybeText } | null;
  thumbnails?: RawThumbnail[] | null;
  /** `LockupView.content_image` (a `ThumbnailView` / `CollectionThumbnailView`). */
  content_image?: {
    image?: RawThumbnail[] | null;
    primary_thumbnail?: { image?: RawThumbnail[] | null } | null;
  } | null;
  video_count?: MaybeText;
  video_count_short?: MaybeText;
  author?: RawAuthorLike | null;
  subscribers?: MaybeText;
  subscriber_count?: MaybeText;
  description_snippet?: MaybeText;
}

/** A youtubei.js `Author` → `ChannelRef`. Shared by comments, playlists, headers. */
export function mapAuthorRef(
  author: RawAuthorLike | null | undefined,
  rewriteImage?: ImageRewriter,
): ChannelRef {
  const a = author ?? {};
  return {
    id: typeof a.id === 'string' ? a.id : '',
    name: nonEmpty(a.name as MaybeText) ?? '',
    avatarUrl: thumbUrl(a.thumbnails, rewriteImage, { maxWidth: 176 }),
  };
}

function cardId(node: RawCardNode): string {
  return (
    (typeof node.id === 'string' && node.id) ||
    (typeof node.content_id === 'string' && node.content_id) ||
    ''
  );
}

function cardThumbUrl(node: RawCardNode, rewriteImage: ImageRewriter | undefined): string | null {
  const image =
    node.thumbnails ??
    node.content_image?.primary_thumbnail?.image ??
    node.content_image?.image ??
    null;
  return thumbUrl(image, rewriteImage);
}

/**
 * `Playlist` / `GridPlaylist` / `LockupView`+`PLAYLIST` → `PlaylistRef`.
 * `null` when there is no playlist id.
 */
export function mapPlaylistRef(
  node: RawCardNode,
  rewriteImage?: ImageRewriter,
): PlaylistRef | null {
  const id = cardId(node);
  if (id.length === 0) return null;
  return {
    id,
    title: nonEmpty(node.title) ?? nonEmpty(node.metadata?.title) ?? '',
    thumbnailUrl: cardThumbUrl(node, rewriteImage),
    videoCount: parseHumanCount(node.video_count) ?? parseHumanCount(node.video_count_short),
  };
}

/**
 * `Channel` / `GridChannel` / `LockupView`+`CHANNEL` → `ChannelDetail`.
 * `null` when there is no channel id. `bannerUrl` and `availableTabs` are not
 * carried by a card node — a full header comes from `getChannel` (P2-4).
 */
export function mapChannelCard(
  node: RawCardNode,
  rewriteImage?: ImageRewriter,
): ChannelDetail | null {
  const author = node.author ?? null;
  const id = cardId(node) || (author != null && typeof author.id === 'string' ? author.id : '');
  if (id.length === 0) return null;

  const ref = mapAuthorRef(author, rewriteImage);
  const name = ref.name || (nonEmpty(node.metadata?.title) ?? nonEmpty(node.title) ?? '');
  const avatarUrl = ref.avatarUrl ?? cardThumbUrl(node, rewriteImage);

  return {
    id,
    name,
    avatarUrl,
    handle: null,
    subscriberText: nonEmpty(node.subscribers) ?? nonEmpty(node.subscriber_count),
    bannerUrl: null,
    description: textToString(node.description_snippet),
    videoCount: parseHumanCount(node.video_count),
    isVerified: author?.is_verified === true,
    availableTabs: [],
  };
}
