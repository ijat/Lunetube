import { useMemo, useState, type ReactNode } from 'react';
import type { VideoDetail } from '@lunetube/shared';
import { renderRichText } from '../../lib/richText.js';

/**
 * The video description (plan P1-6 / mockup `.desc`):
 *  - collapsed to a few lines with a "Show more" / "Show less" toggle;
 *  - `h:mm:ss` / `m:ss` timestamps become clickable seek links
 *    (`parseTimestampsFromText` already ran in the adapter →
 *    `detail.descriptionTimestamps`);
 *  - bare `https://` links open in the OS browser via `app:openExternal`
 *    (shared `lib/richText` helper — https-only, no HTML sink);
 *  - keyword tags render as chips.
 *
 * F5 conflict 1: the mockup sets `.desc a,.ts { font-family: var(--font-mono) }`.
 * The PRD §7 no-monospace rule is LOCKED, so links and timestamps use the body
 * font + `tabular-nums` here (see `watch.css`).
 */

export interface DescriptionProps {
  detail: VideoDetail;
  onSeek: (seconds: number) => void;
}

export function Description({ detail, onSeek }: DescriptionProps) {
  const [expanded, setExpanded] = useState(false);

  const rendered = useMemo<ReactNode[]>(
    () =>
      renderRichText(detail.description, detail.descriptionTimestamps, {
        onSeek,
        timestampClassName: 'watch__ts',
        linkClassName: 'watch__link',
      }),
    [detail.description, detail.descriptionTimestamps, onSeek],
  );

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
