/**
 * Adaptive-format / caption / storyboard mappers. Pure — no I/O.
 *
 * These are the building blocks for `StreamManifest`; assembly lives behind the
 * `PlaybackStrategy` seam (`../../playback/`). Keeping them pure and per-item is
 * what makes the churn-prone streaming surface cheap to fix — a YouTube
 * response-shape change is a one-function edit with a unit test, not a debugging
 * session inside an async pipeline.
 */
import type { AudioTrack, CaptionTrack, StoryboardSpec, VideoTrack } from '@lunetube/shared';
import {
  expireParamMs,
  normalizeUrl,
  rewriteUrl,
  toIntOr,
  toNumberOrNull,
  type MaybeText,
  textToString,
} from './util.js';

/** Fallback stream lifetime when nothing in the response declares one. */
export const DEFAULT_STREAM_TTL_MS = 5 * 60 * 60 * 1000;

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

export interface ExpiryInput {
  /** `info.streaming_data` — may declare `expires` (a `Date`, or an ISO string in fixtures). */
  streamingData?: RawStreamingData | null | undefined;
  /** **Raw** adaptive formats, i.e. before any proxy rewriting (see `expireParamMs`). */
  formats?: RawFormat[] | null | undefined;
  /** Injectable clock for the fallback branch. */
  now?: () => number;
  /** Fallback lifetime. Defaults to `DEFAULT_STREAM_TTL_MS`. */
  fallbackMs?: number;
}

/**
 * When the manifest's media URLs stop working, as epoch ms.
 *
 * This value drives the renderer's pre-emptive re-resolve (plan P1-5), so it is
 * deliberately **pessimistic: the earliest signal wins**. Re-resolving a minute
 * early costs one cheap InnerTube call; re-resolving late costs a burst of 403s
 * in the middle of playback, which is the failure mode plan R1/F3 calls out.
 *
 * Signals, all optional, minimum of whatever is present:
 *  - the `expire` query parameter on each raw googlevideo URL (ground truth for
 *    the URLs actually embedded in the manifest);
 *  - `streaming_data.expires`, which youtubei.js derives from
 *    `expiresInSeconds` at parse time.
 *
 * With no signal at all, `now + 5h` (plan P1-3).
 */
export function resolveExpiresAt(input: ExpiryInput): number {
  const candidates: number[] = [];

  if (Array.isArray(input.formats)) {
    for (const format of input.formats) {
      const expiry = expireParamMs(format.url);
      if (expiry != null) candidates.push(expiry);
    }
  }

  const declared = declaredExpiryMs(input.streamingData?.expires);
  if (declared != null) candidates.push(declared);

  if (candidates.length === 0) {
    const now = input.now ?? Date.now;
    return now() + (input.fallbackMs ?? DEFAULT_STREAM_TTL_MS);
  }
  return Math.min(...candidates);
}

/** `streaming_data.expires` is a `Date` from youtubei.js and an ISO string in fixtures. */
function declaredExpiryMs(expires: unknown): number | null {
  if (expires instanceof Date) {
    const t = expires.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof expires === 'string') {
    const t = Date.parse(expires);
    return Number.isFinite(t) ? t : null;
  }
  if (typeof expires === 'number' && Number.isFinite(expires)) return expires;
  return null;
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
 * `PlayerStoryboardSpec.boards` → `StoryboardSpec[]`. Each spec carries **both**
 * the proxy-rewritten `url` and the raw `templateUrl` (`$L`/`$N`/`$M`
 * placeholders intact). The rewritten `url` is only useful as a whole-sheet
 * fetch; Phase 4's per-tile scrubber preview substitutes the placeholders in
 * `templateUrl` and rewrites each concrete URL through main (decision A11).
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
      // The `/img` rewriter base64-encodes the whole URL into `?u=`, burying the
      // placeholders — so `templateUrl` keeps the raw form for Phase 4's per-tile
      // expansion (decision A11), while `url` is the rewritten whole-sheet form.
      const url = rewriteUrl(template, rewriteImage) ?? template;
      return {
        level,
        url,
        templateUrl: template,
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
