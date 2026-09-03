import { Fragment, useMemo, useState, type ReactNode } from 'react';
import type { VideoDetail } from '@lunetube/shared';
import { bridge } from '../../bridge.js';

/**
 * The video description (plan P1-6 / mockup `.desc`):
 *  - collapsed to a few lines with a "Show more" / "Show less" toggle;
 *  - `h:mm:ss` / `m:ss` timestamps become clickable seek links
 *    (`parseTimestampsFromText` already ran in the adapter →
 *    `detail.descriptionTimestamps`);
 *  - bare `http(s)://` links open in the OS browser via `app:openExternal`
 *    (https-only allow-list in main);
 *  - keyword tags render as chips.
 *
 * F5 conflict 1: the mockup sets `.desc a,.ts { font-family: var(--font-mono) }`.
 * The PRD §7 no-monospace rule is LOCKED, so links and timestamps use the body
 * font + `tabular-nums` here (see `watch.css`).
 */

const URL_RE = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?]/g;

interface Span {
  start: number;
  end: number;
  kind: 'ts' | 'url';
  seconds?: number;
}

function buildSpans(text: string, timestamps: VideoDetail['descriptionTimestamps']): Span[] {
  const spans: Span[] = timestamps.map((t) => ({
    start: t.index,
    end: t.index + t.length,
    kind: 'ts' as const,
    seconds: t.seconds,
  }));
  for (const match of text.matchAll(URL_RE)) {
    if (match.index === undefined) continue;
    spans.push({ start: match.index, end: match.index + match[0].length, kind: 'url' });
  }
  spans.sort((a, b) => a.start - b.start);
  // Drop overlaps (a URL that contains a "timestamp", etc.) — first wins.
  const out: Span[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue;
    out.push(span);
    cursor = span.end;
  }
  return out;
}

function openExternal(url: string): void {
  try {
    void bridge()
      .invoke('app:openExternal', { url })
      .catch(() => undefined);
  } catch {
    /* preload bridge unavailable (unit tests) */
  }
}

export interface DescriptionProps {
  detail: VideoDetail;
  onSeek: (seconds: number) => void;
}

export function Description({ detail, onSeek }: DescriptionProps) {
  const [expanded, setExpanded] = useState(false);

  const rendered = useMemo<ReactNode[]>(() => {
    const text = detail.description;
    if (text.length === 0) return [];
    const spans = buildSpans(text, detail.descriptionTimestamps);
    const nodes: ReactNode[] = [];
    let cursor = 0;
    spans.forEach((span, i) => {
      if (span.start > cursor)
        nodes.push(<Fragment key={`t${i}`}>{text.slice(cursor, span.start)}</Fragment>);
      const label = text.slice(span.start, span.end);
      if (span.kind === 'ts' && span.seconds !== undefined) {
        const seconds = span.seconds;
        nodes.push(
          <button type="button" key={`s${i}`} className="watch__ts" onClick={() => onSeek(seconds)}>
            {label}
          </button>,
        );
      } else {
        nodes.push(
          <button
            type="button"
            key={`u${i}`}
            className="watch__link"
            onClick={() => openExternal(label)}
          >
            {label}
          </button>,
        );
      }
      cursor = span.end;
    });
    if (cursor < text.length) nodes.push(<Fragment key="tail">{text.slice(cursor)}</Fragment>);
    return nodes;
  }, [detail.description, detail.descriptionTimestamps, onSeek]);

  const viewLine =
    detail.viewCount != null
      ? `${new Intl.NumberFormat('en').format(detail.viewCount)} views`
      : null;

  return (
    <div className="watch__desc">
      {(viewLine || detail.publishedText) && (
        <p className="watch__desc-stat tnum">
          {viewLine && <span className="watch__stat">{viewLine}</span>}
          {viewLine && detail.publishedText ? ' · ' : ''}
          {detail.publishedText}
        </p>
      )}

      {rendered.length > 0 && (
        <div className="watch__desc-body" data-expanded={expanded}>
          {rendered}
        </div>
      )}

      {rendered.length > 0 && (
        <button
          type="button"
          className="watch__desc-more"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}

      {detail.keywords.length > 0 && (
        <div className="watch__chips">
          {detail.keywords.slice(0, 12).map((tag) => (
            <span className="watch__chip" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
