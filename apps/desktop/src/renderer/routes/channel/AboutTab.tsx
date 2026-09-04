import { Fragment, useMemo, type ReactNode } from 'react';
import { parseTimestampsFromText, type ChannelAbout } from '@lunetube/shared';
import { bridge } from '../../bridge.js';

/**
 * The channel About tab (plan P2-9). The description gets the same
 * timestamp/link treatment as `watch/Description.tsx` (PRD §3.1) — mirrored
 * here rather than imported, since `Description` is scoped to `VideoDetail`
 * (its `onSeek` callback and pre-parsed `descriptionTimestamps` both assume an
 * active player, which an About tab does not have):
 *  - `h:mm:ss` / `m:ss` timestamps are highlighted with the same tabular-nums
 *    treatment, but as inert text — there is no player on this route to seek,
 *    so unlike `Description` they are not clickable (a dead button is worse
 *    than a plain span, same reasoning as the disabled Follow button).
 *    `ChannelAbout.description` carries no pre-parsed timestamps the way
 *    `VideoDetail` does, so they're found with the same `@lunetube/shared`
 *    helper the video adapter uses server-side.
 *  - bare `http(s)://` links open in the OS browser via `app:openExternal`
 *    (https-only allow-list in main), exactly as `Description` does.
 *
 * `about.subscriberText` / `videoCountText` / `viewCountText` / `joinedText`
 * are already human-formatted upstream text (e.g. `"1.2B views"`, `"Joined
 * Feb 9, 2015"`) — rendered as-is, never re-labelled.
 */

const URL_RE = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?]/g;

interface Span {
  start: number;
  end: number;
  kind: 'ts' | 'url';
}

function buildSpans(text: string): Span[] {
  const spans: Span[] = parseTimestampsFromText(text).map((t) => ({
    start: t.index,
    end: t.index + t.length,
    kind: 'ts' as const,
  }));
  for (const match of text.matchAll(URL_RE)) {
    if (match.index === undefined) continue;
    spans.push({ start: match.index, end: match.index + match[0].length, kind: 'url' });
  }
  spans.sort((a, b) => a.start - b.start);
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

export interface AboutTabProps {
  about: ChannelAbout;
}

export function AboutTab({ about }: AboutTabProps) {
  const rendered = useMemo<ReactNode[]>(() => {
    const text = about.description;
    if (text.length === 0) return [];
    const spans = buildSpans(text);
    const nodes: ReactNode[] = [];
    let cursor = 0;
    spans.forEach((span, i) => {
      if (span.start > cursor)
        nodes.push(<Fragment key={`t${i}`}>{text.slice(cursor, span.start)}</Fragment>);
      const label = text.slice(span.start, span.end);
      if (span.kind === 'ts') {
        nodes.push(
          <span className="chan-about__ts tnum" key={`s${i}`}>
            {label}
          </span>,
        );
      } else {
        nodes.push(
          <button
            type="button"
            key={`u${i}`}
            className="chan-about__link"
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
  }, [about.description]);

  const stats = [
    about.subscriberText,
    about.videoCountText,
    about.viewCountText,
    about.joinedText,
    about.country,
  ].filter((s): s is string => Boolean(s));

  return (
    <div className="chan-about">
      {stats.length > 0 && (
        <p className="chan-about__stats tnum">
          {stats.map((s, i) => (
            <Fragment key={s}>
              {i > 0 && <span aria-hidden="true">·</span>}
              <span>{s}</span>
            </Fragment>
          ))}
        </p>
      )}

      {rendered.length > 0 && <div className="chan-about__desc glass-panel">{rendered}</div>}

      {about.links.length > 0 && (
        <div className="chan-about__links">
          {about.links.map((link) => (
            <button
              type="button"
              key={link.url}
              className="chan-about__link"
              onClick={() => openExternal(link.url)}
            >
              {link.title || link.url}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
