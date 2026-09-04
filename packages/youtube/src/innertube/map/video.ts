/**
 * `VideoInfo` → `VideoDetail` / `VideoSummary`. Pure — no I/O.
 *
 * Every field is read defensively: a missing or renamed key yields a partial DTO
 * (empty string / `null` / `[]`), never a throw. The one hard requirement is a
 * video id; without it the mapper returns `null` and the caller raises
 * `YT_PARSE_CHANGED`.
 */
import type { ChannelRef, VideoDetail, VideoSummary } from '@lunetube/shared';
import { parseTimestampsFromText } from '@lunetube/shared';
import {
  mapChapters,
  mapMostReplayed,
  type RawHeatmap,
  type RawPlayerOverlays,
} from './chapters.js';
import { pickThumbnailUrl, pickThumbnailUrlRewritten, type RawThumbnail } from './thumbnail.js';
import {
  nonEmpty,
  parseHumanCount,
  textToString,
  toBool,
  toNumberOrNull,
  type MaybeText,
} from './util.js';

export interface RawAuthor {
  id?: unknown;
  name?: unknown;
  thumbnails?: RawThumbnail[] | null;
}

export interface RawBasicInfo {
  id?: unknown;
  title?: unknown;
  channel_id?: unknown;
  channel?: { id?: unknown; name?: unknown; url?: unknown } | null;
  author?: unknown;
  short_description?: unknown;
  duration?: unknown;
  view_count?: unknown;
  like_count?: unknown;
  is_live?: unknown;
  is_upcoming?: unknown;
  category?: unknown;
  keywords?: unknown;
  thumbnail?: RawThumbnail[] | null;
}

export interface RawVideoInfo {
  basic_info?: RawBasicInfo | null;
  secondary_info?: {
    description?: MaybeText;
    owner?: { author?: RawAuthor | null; subscriber_count?: MaybeText } | null;
  } | null;
  primary_info?: {
    published?: MaybeText;
    relative_date?: MaybeText;
  } | null;
  player_overlays?: RawPlayerOverlays | null;
  heat_map?: RawHeatmap | null;
}

function keywords(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((k): k is string => typeof k === 'string') : [];
}

/**
 * Optional `(URL) => URL` image rewriter. When supplied by the adapter it routes
 * thumbnail / avatar URLs through the loopback `/img` proxy, so the renderer can
 * (a) display them under a CSP that forbids `https:` images and (b) read their
 * pixels from a same-origin canvas (P1-6 dominant-colour wash). Omitted → raw
 * upstream URLs (mapper unit tests, `LUNE_LIVE` smoke).
 */
export type ImageRewriter = (url: URL) => URL;

/**
 * Best thumbnail URL, routed through `rewriteImage` (the `/img` proxy) when the
 * adapter supplies one. Shared by the video and card mappers.
 */
export function thumbUrl(
  thumbnails: readonly RawThumbnail[] | null | undefined,
  rewriteImage: ImageRewriter | undefined,
  opts?: { maxWidth?: number },
): string | null {
  return rewriteImage
    ? pickThumbnailUrlRewritten(thumbnails, rewriteImage, opts)
    : pickThumbnailUrl(thumbnails, opts);
}

/** Channel reference for a video. Falls back through basic_info → secondary_info. */
export function mapChannelRef(info: RawVideoInfo, rewriteImage?: ImageRewriter): ChannelRef {
  const basic = info.basic_info ?? {};
  const author = info.secondary_info?.owner?.author ?? null;
  const id =
    (typeof basic.channel?.id === 'string' && basic.channel.id) ||
    (typeof basic.channel_id === 'string' && basic.channel_id) ||
    (author != null && typeof author.id === 'string' && author.id) ||
    '';
  const name =
    nonEmpty(basic.channel?.name as MaybeText) ??
    nonEmpty(basic.author as MaybeText) ??
    (author != null ? nonEmpty(author.name as MaybeText) : null) ??
    '';
  const avatarUrl =
    author != null ? thumbUrl(author.thumbnails, rewriteImage, { maxWidth: 176 }) : null;
  return { id, name, avatarUrl };
}

/** The description as plain text — `secondary_info` first, then `short_description`. */
export function mapDescription(info: RawVideoInfo): string {
  const rich = textToString(info.secondary_info?.description);
  if (rich.length > 0) return rich;
  return textToString(info.basic_info?.short_description as MaybeText);
}

export function mapVideoDetail(
  info: RawVideoInfo,
  rewriteImage?: ImageRewriter,
): VideoDetail | null {
  const basic = info.basic_info ?? {};
  const id = typeof basic.id === 'string' && basic.id.length > 0 ? basic.id : null;
  if (id == null) return null;

  const durationSec = toNumberOrNull(basic.duration);
  const description = mapDescription(info);
  const isLive = toBool(basic.is_live);
  const publishedText =
    nonEmpty(info.primary_info?.relative_date) ?? nonEmpty(info.primary_info?.published);

  return {
    id,
    title: textToString(basic.title as MaybeText),
    channel: mapChannelRef(info, rewriteImage),
    durationSec,
    thumbnailUrl: thumbUrl(basic.thumbnail, rewriteImage),
    publishedText,
    viewCount: toNumberOrNull(basic.view_count),
    isLive,
    description,
    descriptionTimestamps: parseTimestampsFromText(description),
    likeCount: toNumberOrNull(basic.like_count),
    keywords: keywords(basic.keywords),
    category: nonEmpty(basic.category as MaybeText),
    chapters: mapChapters({ overlays: info.player_overlays, description, durationSec }),
    mostReplayed: mapMostReplayed(info.heat_map),
    isUpcoming: toBool(basic.is_upcoming),
  };
}

/**
 * A watch-next / related / browse / search feed node → `VideoSummary`. Nodes
 * vary wildly (`Video`, `CompactVideo`, `PlaylistVideo`, `GridVideo`,
 * `ReelItem`, `LockupView`, `ShortsLockupView`, …); read structurally, and
 * dispatch on the readonly `node.type` string for the view-model shapes whose
 * field paths share nothing with the classic renderers (P2-F5). `null` when
 * there is no resolvable video id.
 */
export interface RawFeedVideoNode {
  /** youtubei.js `YTNode.type` — a plain string, no import needed (P2-F5). */
  type?: unknown;
  video_id?: unknown;
  id?: unknown;
  content_id?: unknown;
  /** `LockupView.content_type` — `'VIDEO' | 'SHORT' | 'PLAYLIST' | 'CHANNEL' | …`. */
  content_type?: unknown;
  title?: MaybeText;
  thumbnails?: RawThumbnail[] | null;
  thumbnail?: RawThumbnail[] | null;
  author?: RawAuthor | null;
  short_byline_text?: MaybeText;
  published?: MaybeText;
  view_count?: MaybeText;
  short_view_count?: MaybeText;
  /** `GridVideo` / `ReelItem` put the view count here, as a `Text`. */
  views?: MaybeText;
  length_text?: MaybeText;
  duration?: { seconds?: unknown; text?: unknown } | null;
  is_live?: unknown;
  /** `LockupView.metadata` (a `LockupMetadataView`). */
  metadata?: RawLockupMetadata | null;
  /** `LockupView.content_image` (a `ThumbnailView` or `CollectionThumbnailView`). */
  content_image?: RawLockupImage | null;
  /** `ShortsLockupView`. */
  entity_id?: unknown;
  on_tap_endpoint?: { payload?: { videoId?: unknown } | null } | null;
  overlay_metadata?: { primary_text?: MaybeText; secondary_text?: MaybeText } | null;
}

interface RawMetadataPart {
  text?: MaybeText;
  avatar_stack?: {
    text?: MaybeText;
    avatars?: ({ image?: RawThumbnail[] | null } | null)[] | null;
  } | null;
}
interface RawMetadataRow {
  metadata_parts?: (RawMetadataPart | null)[] | null;
}
interface RawLockupMetadata {
  title?: MaybeText;
  metadata?: { metadata_rows?: (RawMetadataRow | null)[] | null } | null;
}
interface RawThumbnailView {
  image?: RawThumbnail[] | null;
  overlays?: unknown;
}
interface RawLockupImage extends RawThumbnailView {
  primary_thumbnail?: RawThumbnailView | null;
}

/** Number from a `Text`/string count ("8.4M views", "1,234"). `null` if absent. */
function parseCountText(value: MaybeText): number | null {
  const raw = textToString(value).trim();
  if (raw.length === 0) return null;
  return toNumberOrNull(raw) ?? parseHumanCount(raw);
}

function parseViewCount(node: RawFeedVideoNode): number | null {
  const raw =
    textToString(node.view_count) ||
    textToString(node.short_view_count) ||
    textToString(node.views);
  return parseCountText(raw);
}

/** `"1:02:03"` / `"0:42"` / `"90"` → seconds. `null` if not clock-shaped. */
function clockTextToSeconds(text: string): number | null {
  const t = text.trim();
  if (t.length === 0) return null;
  const parts = t.split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function parseDurationSec(node: RawFeedVideoNode): number | null {
  const fromObj = toNumberOrNull(node.duration?.seconds);
  if (fromObj != null && fromObj > 0) return fromObj;
  const text = textToString(node.length_text) || textToString(node.duration?.text as MaybeText);
  return clockTextToSeconds(text);
}

/** Every badge `text` / `badge_style` string across a thumbnail's overlays. */
function overlayBadgeTexts(overlays: unknown): string[] {
  if (!Array.isArray(overlays)) return [];
  const out: string[] = [];
  for (const overlay of overlays) {
    const badges = (overlay as { badges?: unknown } | null)?.badges;
    if (!Array.isArray(badges)) continue;
    for (const badge of badges) {
      const b = badge as { text?: unknown; badge_style?: unknown; style?: unknown } | null;
      if (typeof b?.text === 'string' && b.text.length > 0) out.push(b.text);
      if (typeof b?.badge_style === 'string') out.push(b.badge_style);
      if (typeof b?.style === 'string') out.push(b.style);
    }
  }
  return out;
}

function lockupThumbView(image: RawLockupImage | null | undefined): RawThumbnailView | null {
  if (image == null) return null;
  return image.primary_thumbnail ?? image;
}

function lockupChannel(
  rows: (RawMetadataRow | null)[],
  rewriteImage: ImageRewriter | undefined,
): ChannelRef {
  for (const row of rows) {
    const parts = row?.metadata_parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const stack = part?.avatar_stack;
      if (stack == null) continue;
      const name = nonEmpty(part?.text) ?? nonEmpty(stack.text) ?? '';
      const avatar = Array.isArray(stack.avatars) ? stack.avatars[0] : null;
      return {
        id: '',
        name,
        avatarUrl: avatar != null ? thumbUrl(avatar.image, rewriteImage, { maxWidth: 176 }) : null,
      };
    }
  }
  return { id: '', name: '', avatarUrl: null };
}

/**
 * View count + published date live as sibling text parts of one metadata row,
 * split by `ContentMetadataView.delimiter`. Row/part ordering is not guaranteed
 * (P2-2(c) ASSUMPTION), so locate the view-count part by "looks like a count"
 * and take the other text part as the published date.
 */
function lockupCounts(rows: (RawMetadataRow | null)[]): {
  viewCount: number | null;
  publishedText: string | null;
} {
  for (const row of rows) {
    const parts = row?.metadata_parts;
    if (!Array.isArray(parts)) continue;
    const texts = parts
      .filter((p) => p?.avatar_stack == null)
      .map((p) => nonEmpty(p?.text))
      .filter((t): t is string => t != null);
    if (texts.length === 0) continue;
    const viewIdx = texts.findIndex((t) => /^[\d,.]+\s*[KMB]?\s*(views?|watching)/i.test(t));
    if (viewIdx === -1) continue;
    return {
      viewCount: parseHumanCount(texts[viewIdx]),
      publishedText: texts.find((_, i) => i !== viewIdx) ?? null,
    };
  }
  return { viewCount: null, publishedText: null };
}

/** `LockupView` with `content_type` `'VIDEO'` / `'SHORT'` → `VideoSummary`. */
function mapLockupVideo(
  node: RawFeedVideoNode,
  rewriteImage: ImageRewriter | undefined,
): VideoSummary | null {
  const id =
    typeof node.content_id === 'string' && node.content_id.length > 0 ? node.content_id : '';
  if (id.length === 0) return null;

  const meta = node.metadata ?? null;
  const rows = (meta?.metadata?.metadata_rows ?? []).filter((r): r is RawMetadataRow => r != null);
  const thumbView = lockupThumbView(node.content_image);
  const badges = overlayBadgeTexts(thumbView?.overlays);
  const durationText = badges.find((t) => /^\d+(:\d{2})+$/.test(t.trim()));
  const { viewCount, publishedText } = lockupCounts(rows);

  return {
    id,
    title: textToString(meta?.title),
    channel: lockupChannel(rows, rewriteImage),
    durationSec: durationText != null ? clockTextToSeconds(durationText) : null,
    thumbnailUrl: thumbUrl(thumbView?.image, rewriteImage),
    publishedText,
    viewCount,
    isLive: badges.some((t) => /live/i.test(t)),
  };
}

/** `ShortsLockupView` → `VideoSummary`. */
function mapShortsLockup(
  node: RawFeedVideoNode,
  rewriteImage: ImageRewriter | undefined,
): VideoSummary | null {
  const fromEndpoint = node.on_tap_endpoint?.payload?.videoId;
  const id =
    (typeof fromEndpoint === 'string' && fromEndpoint) ||
    (typeof node.entity_id === 'string' && node.entity_id) ||
    '';
  if (id.length === 0) return null;

  const overlay = node.overlay_metadata ?? null;
  return {
    id,
    title: textToString(overlay?.primary_text),
    channel: { id: '', name: '', avatarUrl: null },
    durationSec: null,
    thumbnailUrl: thumbUrl(node.thumbnail ?? node.thumbnails, rewriteImage),
    publishedText: null,
    viewCount: parseCountText(overlay?.secondary_text),
    isLive: false,
  };
}

export function mapFeedVideo(
  node: RawFeedVideoNode,
  rewriteImage?: ImageRewriter,
): VideoSummary | null {
  const type = typeof node.type === 'string' ? node.type : '';
  if (type === 'LockupView') {
    // A `LockupView` is also how playlists and channels arrive — those are not
    // videos and belong to `map/cards.ts`.
    const ct = typeof node.content_type === 'string' ? node.content_type : '';
    if (ct !== 'VIDEO' && ct !== 'SHORT') return null;
    return mapLockupVideo(node, rewriteImage);
  }
  if (type === 'ShortsLockupView') return mapShortsLockup(node, rewriteImage);

  const id =
    (typeof node.video_id === 'string' && node.video_id) ||
    (typeof node.id === 'string' && node.id) ||
    (typeof node.content_id === 'string' && node.content_id) ||
    '';
  if (id.length === 0) return null;

  const author = node.author ?? null;
  const channel: ChannelRef = {
    id: author != null && typeof author.id === 'string' ? author.id : '',
    name:
      (author != null ? nonEmpty(author.name as MaybeText) : null) ??
      nonEmpty(node.short_byline_text) ??
      '',
    avatarUrl: author != null ? thumbUrl(author.thumbnails, rewriteImage, { maxWidth: 176 }) : null,
  };

  return {
    id,
    title: textToString(node.title),
    channel,
    durationSec: parseDurationSec(node),
    thumbnailUrl: thumbUrl(node.thumbnails ?? node.thumbnail, rewriteImage),
    publishedText: nonEmpty(node.published),
    viewCount: parseViewCount(node),
    isLive: toBool(node.is_live),
  };
}

export function mapFeedVideos(
  nodes: readonly RawFeedVideoNode[] | null | undefined,
  rewriteImage?: ImageRewriter,
): VideoSummary[] {
  if (!Array.isArray(nodes)) return [];
  return nodes
    .map((node) => mapFeedVideo(node, rewriteImage))
    .filter((v): v is VideoSummary => v != null);
}
