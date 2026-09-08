import { useMemo, type ReactNode } from 'react';
import type { TextTimestamp } from '@lunetube/shared';
import { renderRichText } from '../../lib/richText.js';

/**
 * A comment body (plan P2-10): plain text, with `h:mm:ss` / `m:ss` timestamps
 * turned into seek buttons and bare `https://` URLs turned into buttons that
 * open in the OS browser. All of that lives in the shared `lib/richText`
 * helper (no HTML sink, https-only, non-https URLs render as plain text — see
 * its header); this component only owns the wrapper element.
 */

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
  const nodes = useMemo<ReactNode[]>(
    () =>
      renderRichText(text, timestamps, {
        onSeek,
        timestampClassName: 'watch__ts',
        linkClassName: 'watch__link',
      }),
    [text, timestamps, onSeek],
  );

  return <div className="comment__text">{nodes}</div>;
}
