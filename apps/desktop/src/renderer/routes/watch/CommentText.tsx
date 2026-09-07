import { Fragment, useMemo, type ReactNode } from 'react';
import type { TextTimestamp } from '@lunetube/shared';
import { bridge } from '../../bridge.js';

/**
 * A comment body (plan P2-10): plain text, with `h:mm:ss` / `m:ss` timestamps
 * turned into seek buttons and bare `http(s)://` URLs turned into buttons that
 * open in the OS browser.
 *
 * **There is no HTML sink here and there must never be one.** Comment text is
 * the first third-party, user-generated string the renderer displays. The
 * adapter deliberately extracts it with `textToString` and never calls
 * youtubei.js' `Text.toHTML()` (`packages/youtube/src/innertube/map/comments.ts`
 * file header), and the repo has zero `dangerouslySetInnerHTML` — a property the
 * security ledger records. Everything below is JSX children, so the text is
 * escaped by React no matter what it contains. For the same reason a URL found
 * in a comment renders as a `<button>` routed through `app:openExternal`
 * (https-only allow-list in main), never as an `<a href>` that Chromium would
 * resolve itself.
 *
 * The span-splitting below mirrors `Description.tsx` (and `channel/AboutTab.tsx`,
 * which mirrors it again for text with no player to seek). It is deliberately
 * *not* imported from `Description`: that component is bound to `VideoDetail`
 * and owns collapse/keywords/stat-line behaviour a comment has none of, and
 * P2-10's file scope does not include rewriting the other two call sites. The
 * shared extraction (a `renderer/lib/richText.ts` taking `(text, timestamps)`
 * and an optional `onSeek`) is the right follow-up and is recorded as such.
 */

const URL_RE = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?]/g;

interface Span {
  start: number;
  end: number;
  kind: 'ts' | 'url';
  seconds?: number;
}

/** Non-overlapping, ordered spans over `text`; on a tie the earlier one wins. */
function buildSpans(text: string, timestamps: readonly TextTimestamp[]): Span[] {
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

export interface CommentTextProps {
  text: string;
  /** Pre-parsed by the adapter (`Comment.textTimestamps`). */
  timestamps: readonly TextTimestamp[];
  /**
   * The watch page's `handleSeek`, which already copes with a click that lands
   * before the player has mounted (P1-6 / F6).
   */
  onSeek: (seconds: number) => void;
}

export function CommentText({ text, timestamps, onSeek }: CommentTextProps) {
  const nodes = useMemo<ReactNode[]>(() => {
    if (text.length === 0) return [];
    const spans = buildSpans(text, timestamps);
    if (spans.length === 0) return [text];

    const out: ReactNode[] = [];
    let cursor = 0;
    spans.forEach((span, i) => {
      if (span.start > cursor) {
        out.push(<Fragment key={`t${i}`}>{text.slice(cursor, span.start)}</Fragment>);
      }
      const label = text.slice(span.start, span.end);
      if (span.kind === 'ts' && span.seconds !== undefined) {
        const { seconds } = span;
        out.push(
          <button type="button" key={`s${i}`} className="watch__ts" onClick={() => onSeek(seconds)}>
            {label}
          </button>,
        );
      } else {
        out.push(
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
    if (cursor < text.length) out.push(<Fragment key="tail">{text.slice(cursor)}</Fragment>);
    return out;
  }, [text, timestamps, onSeek]);

  return <div className="comment__text">{nodes}</div>;
}
