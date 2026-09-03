/**
 * Chapters and "most replayed". Pure — no I/O.
 *
 * Chapters come from, in priority order:
 *   1. `player_overlays.decorated_player_bar` markers (YouTube-authored), else
 *   2. `h:mm:ss` timestamps parsed out of the description (`parseTimestampsFromText`).
 *
 * "Most replayed" is the `heat_map` (youtubei.js `Heatmap`) — normalised peaks
 * over the timeline (PRD §5 scrubber, plan F2).
 */
import type { Chapter } from '@lunetube/shared';
import { parseTimestampsFromText } from '@lunetube/shared';
import { pickThumbnailUrl, type RawThumbnail } from './thumbnail.js';
import { nonEmpty, toNumberOrNull, type MaybeText } from './util.js';

export interface RawHeatMarker {
  time_range_start_millis?: unknown;
  marker_duration_millis?: unknown;
  heat_marker_intensity_score_normalized?: unknown;
}

export interface RawHeatmap {
  heat_markers?: RawHeatMarker[] | null;
}

export interface RawChapterNode {
  title?: MaybeText;
  time_range_start_millis?: unknown;
  thumbnail?: RawThumbnail[] | null;
}

export interface RawMarker {
  value?: {
    chapters?: RawChapterNode[] | null;
    heatmap?: RawHeatmap | null;
  } | null;
}

export interface RawPlayerOverlays {
  decorated_player_bar?: {
    player_bar?: {
      markers_map?: RawMarker[] | null;
    } | null;
  } | null;
}

const SEPARATORS = new Set([
  ' ',
  '\t',
  '-',
  '–',
  '—',
  ':',
  '.',
  '·',
  '•',
  '|',
  '(',
  ')',
  '[',
  ']',
  '<',
  '>',
]);

/** Trim leading/trailing separator punctuation from a chapter label. */
function trimSeparators(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && SEPARATORS.has(s.charAt(start))) start += 1;
  while (end > start && SEPARATORS.has(s.charAt(end - 1))) end -= 1;
  return s.slice(start, end);
}

function closeChapters(
  partials: { title: string; startSec: number; thumbnailUrl: string | null }[],
  durationSec: number | null,
  source: Chapter['source'],
): Chapter[] {
  return partials
    .slice()
    .sort((a, b) => a.startSec - b.startSec)
    .map((c, i, all) => {
      const next = all[i + 1];
      const endSec = next != null ? next.startSec : durationSec;
      const chapter: Chapter = { title: c.title, startSec: c.startSec, endSec, source };
      if (c.thumbnailUrl != null) chapter.thumbnailUrl = c.thumbnailUrl;
      return chapter;
    });
}

/** Chapters from the decorated player bar; `[]` when absent. */
export function mapChaptersFromPlayerBar(
  overlays: RawPlayerOverlays | null | undefined,
  durationSec: number | null,
): Chapter[] {
  const markers = overlays?.decorated_player_bar?.player_bar?.markers_map;
  if (!Array.isArray(markers)) return [];

  const nodes: RawChapterNode[] = [];
  for (const marker of markers) {
    const chapters = marker?.value?.chapters;
    if (Array.isArray(chapters)) nodes.push(...chapters);
  }
  if (nodes.length === 0) return [];

  const partials = nodes
    .map((n) => {
      const startMs = toNumberOrNull(n.time_range_start_millis);
      const title = nonEmpty(n.title);
      if (startMs == null || title == null) return null;
      return {
        title,
        startSec: Math.round(startMs / 1000),
        thumbnailUrl: pickThumbnailUrl(n.thumbnail),
      };
    })
    .filter(
      (c): c is { title: string; startSec: number; thumbnailUrl: string | null } => c != null,
    );

  return closeChapters(partials, durationSec, 'youtube');
}

/** Chapters inferred from timestamps in the description; `[]` when none / only one. */
export function mapChaptersFromDescription(
  description: string,
  durationSec: number | null,
): Chapter[] {
  if (typeof description !== 'string' || description.length === 0) return [];
  const lines = description.split('\n');
  const partials: { title: string; startSec: number; thumbnailUrl: string | null }[] = [];

  for (const line of lines) {
    const stamps = parseTimestampsFromText(line);
    const first = stamps[0];
    if (first == null) continue;
    const label = trimSeparators(
      line.slice(0, first.index) + line.slice(first.index + first.length),
    ).trim();
    partials.push({
      title: label.length > 0 ? label : `Chapter ${partials.length + 1}`,
      startSec: first.seconds,
      thumbnailUrl: null,
    });
  }

  // A single timestamp isn't a chapter list.
  if (partials.length < 2) return [];
  return closeChapters(partials, durationSec, 'description');
}

/** Player-bar chapters if present, otherwise description-derived. */
export function mapChapters(args: {
  overlays: RawPlayerOverlays | null | undefined;
  description: string;
  durationSec: number | null;
}): Chapter[] {
  const fromBar = mapChaptersFromPlayerBar(args.overlays, args.durationSec);
  if (fromBar.length > 0) return fromBar;
  return mapChaptersFromDescription(args.description, args.durationSec);
}

/** `heat_map` → normalised most-replayed peaks. `[]` when absent. */
export function mapMostReplayed(
  heatmap: RawHeatmap | null | undefined,
): { positionSec: number; intensity: number }[] {
  const markers = heatmap?.heat_markers;
  if (!Array.isArray(markers)) return [];
  return markers
    .map((m) => {
      const startMs = toNumberOrNull(m.time_range_start_millis);
      const intensity = toNumberOrNull(m.heat_marker_intensity_score_normalized);
      if (startMs == null || intensity == null) return null;
      return {
        positionSec: startMs / 1000,
        intensity: Math.max(0, Math.min(1, intensity)),
      };
    })
    .filter((p): p is { positionSec: number; intensity: number } => p != null);
}
