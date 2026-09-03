/**
 * Presentation formatters. All numeric output is designed to be rendered with
 * `font-variant-numeric: tabular-nums` (PRD §7 — no monospace family anywhere).
 */

/** A clickable timestamp found in free text (description / comment). */
export interface TextTimestamp {
  /** Character offset of the match within the source string. */
  index: number;
  /** Length of the matched substring. */
  length: number;
  /** Resolved absolute offset into the video, in seconds. */
  seconds: number;
}

/**
 * `formatDuration(11051)` -> `"3:04:11"`, `formatDuration(42)` -> `"0:42"`.
 * Minutes never overflow into a bare `62:03`; anything >= 1h rolls into hours.
 * Non-finite / negative input clamps to `0`.
 */
export function formatDuration(totalSeconds: number): string {
  let t = Number.isFinite(totalSeconds) ? Math.floor(totalSeconds) : 0;
  if (t < 0) t = 0;
  const s = t % 60;
  const m = Math.floor(t / 60) % 60;
  const h = Math.floor(t / 3600);
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

const compactFormatter = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** `formatCompactCount(1_234_567)` -> `"1.2M"`. Non-finite input -> `"0"`. */
export function formatCompactCount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return compactFormatter.format(Math.trunc(value));
}

const relativeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const RELATIVE_UNITS: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
  { unit: 'year', seconds: 31_536_000 },
  { unit: 'month', seconds: 2_592_000 },
  { unit: 'week', seconds: 604_800 },
  { unit: 'day', seconds: 86_400 },
  { unit: 'hour', seconds: 3_600 },
  { unit: 'minute', seconds: 60 },
  { unit: 'second', seconds: 1 },
];

/**
 * `formatRelativeDate(fiveMinutesAgo)` -> `"5 minutes ago"`.
 * Accepts a `Date`, epoch-ms number, or ISO string. Invalid input -> `""`.
 */
export function formatRelativeDate(
  input: Date | number | string,
  now: Date | number = Date.now(),
): string {
  const then = input instanceof Date ? input.getTime() : new Date(input).getTime();
  const ref = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(then)) return '';
  const deltaSec = Math.round((then - ref) / 1000);
  const abs = Math.abs(deltaSec);
  for (const { unit, seconds } of RELATIVE_UNITS) {
    if (abs >= seconds || unit === 'second') {
      return relativeFormatter.format(Math.round(deltaSec / seconds), unit);
    }
  }
  return relativeFormatter.format(0, 'second');
}

const TIMESTAMP_RE = /(?<![\w:])(\d{1,3}):([0-5]?\d)(?::([0-5]\d))?(?![\w:])/g;

/**
 * Extracts `h:mm:ss` / `m:ss` timestamps from free text so they can be rendered
 * as clickable seek links (PRD §3.1 clickable description timestamps, §3.3
 * clickable comment timestamps).
 */
export function parseTimestampsFromText(text: string): TextTimestamp[] {
  const out: TextTimestamp[] = [];
  for (const match of text.matchAll(TIMESTAMP_RE)) {
    const { index } = match;
    const g1 = match[1];
    const g2 = match[2];
    if (index === undefined || g1 === undefined || g2 === undefined) continue;
    const a = Number(g1);
    const b = Number(g2);
    const g3 = match[3];
    const seconds = g3 === undefined ? a * 60 + b : a * 3600 + b * 60 + Number(g3);
    out.push({ index, length: match[0].length, seconds });
  }
  return out;
}
