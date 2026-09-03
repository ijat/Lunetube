/**
 * Adaptive-format / caption / storyboard mappers. Pure — no I/O.
 *
 * These are the building blocks for `StreamManifest`. Phase 1 (P1-1) provides the
 * per-item mappers and a straightforward assembly in `source.ts`; P1-3 rewires
 * assembly behind the `PlaybackStrategy` seam (`toDash()` + URL-expiry recovery).
 * Keeping these pure and per-item is what makes the churn-prone streaming surface
 * cheap to fix.
 */
import type { AudioTrack, CaptionTrack, StoryboardSpec, VideoTrack } from '@lunetube/shared';
import {
  normalizeUrl,
  rewriteUrl,
  toIntOr,
  toNumberOrNull,
  type MaybeText,
  textToString,
} from './util.js';

export interface RawFormat {
  itag?: unknown;
  url?: unknown;
  mime_type?: unknown;
  bitrate?: unknown;
  average_bitrate?: unknown;
  width?: unknown;
  height?: unknown;
  fps?: unknown;
  audio_sample_rate?: unknown;
  audio_channels?: unknown;
  language?: unknown;
  has_audio?: unknown;
  has_video?: unknown;
  is_original?: unknown;
  is_dubbed?: unknown;
  audio_track?: { audio_is_default?: unknown; display_name?: unknown; id?: unknown } | null;
}

export interface RawStreamingData {
  expires?: unknown;
  formats?: RawFormat[] | null;
  adaptive_formats?: RawFormat[] | null;
  dash_manifest_url?: unknown;
  hls_manifest_url?: unknown;
  server_abr_streaming_url?: unknown;
}

export interface RawCaptionTrack {
  base_url?: unknown;
  name?: MaybeText;
  language_code?: unknown;
  kind?: unknown;
}

export interface RawCaptions {
  caption_tracks?: RawCaptionTrack[] | null;
}

export interface RawStoryboardBoard {
  template_url?: unknown;
  thumbnail_width?: unknown;
  thumbnail_height?: unknown;
  thumbnail_count?: unknown;
  interval?: unknown;
  columns?: unknown;
  rows?: unknown;
  storyboard_count?: unknown;
}

export interface RawStoryboards {
  boards?: RawStoryboardBoard[] | null;
}

/** `video/mp4; codecs="avc1.640028"` → `{ container: 'video/mp4', codec: 'avc1.640028' }`. */
export function parseMimeType(mimeType: unknown): { container: string; codec: string } {
  const raw = typeof mimeType === 'string' ? mimeType : '';
  const [container = '', ...rest] = raw.split(';');
  const params = rest.join(';');
  const match = /codecs\s*=\s*"?([^"]+)"?/i.exec(params);
  return { container: container.trim(), codec: match?.[1]?.trim() ?? '' };
}

function itagId(f: RawFormat, fallback: string): string {
  const itag = toNumberOrNull(f.itag);
  return itag == null ? fallback : String(itag);
}

function bitrateOf(f: RawFormat): number {
  return toIntOr(f.bitrate ?? f.average_bitrate, 0);
}

/** A video adaptive format → `VideoTrack`. `null` when it carries no usable URL. */
export function mapVideoTrack(
  f: RawFormat,
  rewriteMedia: (url: URL) => URL,
  index = 0,
): VideoTrack | null {
  const url = rewriteUrl(f.url, rewriteMedia);
  if (url == null) return null;
  const { container, codec } = parseMimeType(f.mime_type);
  return {
    id: itagId(f, `v${index}`),
    mimeType: container,
    codec,
    bitrate: bitrateOf(f),
    width: toIntOr(f.width, 0),
    height: toIntOr(f.height, 0),
    fps: toIntOr(f.fps, 0),
    url,
  };
}

/** An audio adaptive format → `AudioTrack`. `null` when it carries no usable URL. */
export function mapAudioTrack(
  f: RawFormat,
  rewriteMedia: (url: URL) => URL,
  index = 0,
): AudioTrack | null {
  const url = rewriteUrl(f.url, rewriteMedia);
  if (url == null) return null;
  const { container, codec } = parseMimeType(f.mime_type);
  const language = typeof f.language === 'string' && f.language.length > 0 ? f.language : null;
  const isDefault =
    f.audio_track != null && typeof f.audio_track === 'object'
      ? f.audio_track.audio_is_default === true
      : f.is_original === true;
  return {
    id: itagId(f, `a${index}`),
    mimeType: container,
    codec,
    bitrate: bitrateOf(f),
    sampleRate: toIntOr(f.audio_sample_rate, 0),
    channels: toIntOr(f.audio_channels, 2),
    language,
    isDefault,
    url,
  };
}

/** Split `adaptive_formats` into video-only and audio-only lists. */
export function partitionAdaptiveFormats(formats: RawFormat[] | null | undefined): {
  video: RawFormat[];
  audio: RawFormat[];
} {
  const video: RawFormat[] = [];
  const audio: RawFormat[] = [];
  if (!Array.isArray(formats)) return { video, audio };
  for (const f of formats) {
    const { container } = parseMimeType(f.mime_type);
    const isVideo = f.has_video === true || container.startsWith('video/');
    const isAudio = f.has_audio === true || container.startsWith('audio/');
    // Adaptive formats are single-track; treat a muxed format as video.
    if (isVideo) video.push(f);
    else if (isAudio) audio.push(f);
  }
  return { video, audio };
}

export function mapVideoTracks(
  formats: RawFormat[] | null | undefined,
  rewriteMedia: (url: URL) => URL,
): VideoTrack[] {
  const { video } = partitionAdaptiveFormats(formats);
  return video
    .map((f, i) => mapVideoTrack(f, rewriteMedia, i))
    .filter((t): t is VideoTrack => t != null)
    .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);
}

export function mapAudioTracks(
  formats: RawFormat[] | null | undefined,
  rewriteMedia: (url: URL) => URL,
): AudioTrack[] {
  const { audio } = partitionAdaptiveFormats(formats);
  return audio
    .map((f, i) => mapAudioTrack(f, rewriteMedia, i))
    .filter((t): t is AudioTrack => t != null)
    .sort((a, b) => b.bitrate - a.bitrate);
}

/** youtubei.js caption track → `CaptionTrack`. `null` without a base URL. */
export function mapCaptionTrack(
  c: RawCaptionTrack,
  rewriteCaption: (url: URL) => URL,
): CaptionTrack | null {
  const url = rewriteUrl(c.base_url, rewriteCaption);
  if (url == null) return null;
  const languageCode = typeof c.language_code === 'string' ? c.language_code : '';
  return {
    languageCode,
    label: textToString(c.name) || languageCode || 'Unknown',
    kind: c.kind === 'asr' ? 'asr' : 'standard',
    url,
  };
}

export function mapCaptionTracks(
  captions: RawCaptions | null | undefined,
  rewriteCaption: (url: URL) => URL,
): CaptionTrack[] {
  const tracks = captions?.caption_tracks;
  if (!Array.isArray(tracks)) return [];
  return tracks
    .map((c) => mapCaptionTrack(c, rewriteCaption))
    .filter((t): t is CaptionTrack => t != null);
}

/**
 * `PlayerStoryboardSpec.boards` → `StoryboardSpec[]`. The `template_url` keeps
 * its `$L`/`$N`/`$M` placeholders (Phase 4 expands them for the scrubber
 * preview); only the host is rewritten through the `/img` proxy route.
 */
export function mapStoryboards(
  storyboards: RawStoryboards | null | undefined,
  rewriteImage: (url: URL) => URL,
): StoryboardSpec[] {
  const boards = storyboards?.boards;
  if (!Array.isArray(boards)) return [];
  return boards
    .map((b, level): StoryboardSpec | null => {
      const template = normalizeUrl(b.template_url);
      if (template == null) return null;
      // `$L`/`$N`/`$M` are valid URL characters, so the template parses as-is.
      // NOTE (P1-3 / Phase 4): the real `/img` rewriter base64-encodes the whole
      // URL into `?u=`, which would bury these placeholders — storyboard preview
      // expansion needs the rewriter applied per-tile after substitution, not here.
      const url = rewriteUrl(template, rewriteImage) ?? template;
      return {
        level,
        url,
        rows: toIntOr(b.rows, 0),
        columns: toIntOr(b.columns, 0),
        intervalMs: toIntOr(b.interval, 0),
        thumbnailWidth: toIntOr(b.thumbnail_width, 0),
        thumbnailHeight: toIntOr(b.thumbnail_height, 0),
        thumbnailCount: toIntOr(b.thumbnail_count, 0),
      };
    })
    .filter((s): s is StoryboardSpec => s != null);
}
