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
import { pickThumbnailUrl, type RawThumbnail } from './thumbnail.js';
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

/** Channel reference for a video. Falls back through basic_info → secondary_info. */
export function mapChannelRef(info: RawVideoInfo): ChannelRef {
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
  const avatarUrl = author != null ? pickThumbnailUrl(author.thumbnails, { maxWidth: 176 }) : null;
  return { id, name, avatarUrl };
}

/** The description as plain text — `secondary_info` first, then `short_description`. */
export function mapDescription(info: RawVideoInfo): string {
  const rich = textToString(info.secondary_info?.description);
  if (rich.length > 0) return rich;
  return textToString(info.basic_info?.short_description as MaybeText);
}

export function mapVideoDetail(info: RawVideoInfo): VideoDetail | null {
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
    channel: mapChannelRef(info),
    durationSec,
    thumbnailUrl: pickThumbnailUrl(basic.thumbnail),
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
 * A watch-next / related feed node → `VideoSummary`. Nodes vary
 * (`CompactVideo`, `Video`, `LockupView`, …); read structurally. `null` when
 * there's no video id.
 */
export interface RawFeedVideoNode {
  video_id?: unknown;
  id?: unknown;
  content_id?: unknown;
  title?: MaybeText;
  thumbnails?: RawThumbnail[] | null;
  thumbnail?: RawThumbnail[] | null;
  author?: RawAuthor | null;
  short_byline_text?: MaybeText;
  published?: MaybeText;
  view_count?: MaybeText;
  short_view_count?: MaybeText;
  length_text?: MaybeText;
  duration?: { seconds?: unknown; text?: unknown } | null;
  is_live?: unknown;
}

function parseViewCount(node: RawFeedVideoNode): number | null {
  const raw = textToString(node.view_count) || textToString(node.short_view_count);
  return toNumberOrNull(raw) ?? parseHumanCount(raw);
}

function parseDurationSec(node: RawFeedVideoNode): number | null {
  const fromObj = toNumberOrNull(node.duration?.seconds);
  if (fromObj != null && fromObj > 0) return fromObj;
  const text = textToString(node.length_text) || textToString(node.duration?.text as MaybeText);
  if (text.length === 0) return null;
  const parts = text.split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function mapFeedVideo(node: RawFeedVideoNode): VideoSummary | null {
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
    avatarUrl: author != null ? pickThumbnailUrl(author.thumbnails, { maxWidth: 176 }) : null,
  };

  return {
    id,
    title: textToString(node.title),
    channel,
    durationSec: parseDurationSec(node),
    thumbnailUrl: pickThumbnailUrl(node.thumbnails ?? node.thumbnail),
    publishedText: nonEmpty(node.published),
    viewCount: parseViewCount(node),
    isLive: toBool(node.is_live),
  };
}

export function mapFeedVideos(
  nodes: readonly RawFeedVideoNode[] | null | undefined,
): VideoSummary[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.map(mapFeedVideo).filter((v): v is VideoSummary => v != null);
}
