import { Fragment, type ReactNode } from 'react';
import type { TextTimestamp } from '@lunetube/shared';
import { bridge } from '../bridge.js';

/**
 * The renderer's single third-party-text → JSX path (plan P2-9's "reuse that
 * component's link handling"). Shared by comment bodies (`watch/CommentText`),
 * the video description (`watch/Description`) and the channel About tab
 * (`channel/AboutTab`) — before this it was three near-identical copies.
 *
 * **There is no HTML sink here and there must never be one.** This is the first
 * third-party, user-generated string the renderer displays. The adapter
 * deliberately extracts it with `textToString` and never calls youtubei.js'
 * `Text.toHTML()` (`packages/youtube/src/innertube/map/comments.ts` header), and
 * the repo has zero `dangerouslySetInnerHTML` — a property the security ledger
 * records. Everything below is JSX children, so React escapes the text no matter
 * what it contains.
 *
 * A URL renders as a `<button>` routed through `app:openExternal` (https-only
 * allow-list in main), never as an `<a href>` Chromium would resolve itself. A
 * **non-`https:` URL renders as plain text** (F7): `app:openExternal` rejects a
 * non-https scheme, so a button would be a dead affordance with no feedback.
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

export interface RichTextOptions {
  /**
   * When provided, `h:mm:ss` / `m:ss` timestamps render as seek buttons; when
   * omitted they render as inert spans (an About tab has no player to seek — a
   * dead button is worse than a plain span).
   */
  onSeek?: (seconds: number) => void;
  /** Class for the timestamp button / span. */
  timestampClassName: string;
  /** Class for the external-URL button. */
  linkClassName: string;
}

/**
 * Split `text` into escaped plain-text fragments, timestamp nodes and
 * external-URL buttons. Callers own their own wrapper element and `useMemo`.
 */
export function renderRichText(
  text: string,
  timestamps: readonly TextTimestamp[],
  options: RichTextOptions,
): ReactNode[] {
  if (text.length === 0) return [];
  const spans = buildSpans(text, timestamps);
  if (spans.length === 0) return [text];

  const { onSeek, timestampClassName, linkClassName } = options;
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
        onSeek ? (
          <button
            type="button"
            key={`s${i}`}
            className={timestampClassName}
            onClick={() => onSeek(seconds)}
          >
            {label}
          </button>
        ) : (
          <span key={`s${i}`} className={timestampClassName}>
            {label}
          </span>
        ),
      );
    } else if (span.kind === 'url' && /^https:\/\//i.test(label)) {
      out.push(
        <button
          type="button"
          key={`u${i}`}
          className={linkClassName}
          onClick={() => openExternal(label)}
        >
          {label}
        </button>,
      );
    } else {
      // A non-https URL (F7), or a timestamp span with no resolved seconds —
      // render the literal text, no affordance.
      out.push(<Fragment key={`x${i}`}>{label}</Fragment>);
    }
    cursor = span.end;
  });
  if (cursor < text.length) out.push(<Fragment key="tail">{text.slice(cursor)}</Fragment>);
  return out;
}
