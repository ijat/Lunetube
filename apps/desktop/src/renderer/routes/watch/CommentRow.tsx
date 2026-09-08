import { memo } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, Heart, Pin, ThumbsUp } from 'lucide-react';
import { formatCompactCount, type Comment } from '@lunetube/shared';
import { loopbackImage } from '../../lib/img.js';
import { CommentText } from './CommentText.js';

/**
 * One comment (plan P2-10 / PRD §3.3). Top-level and reply rows are the same
 * component at `depth` 0 and 1 — YouTube has no third level, and the adapter
 * flattens replies to exactly one (`map/comments.ts#mapReplyComments`).
 *
 * Badges, all from the DTO:
 *  - **pinned** → "Pinned by <uploader>";
 *  - **hearted** → the creator heart, labelled with the uploader's name;
 *  - **uploader** → an accent-tinted author chip (the PRD's author highlighting);
 *  - **verified** → a tick beside the name;
 *  - **like count** → tabular numerals via `.tnum`, hidden when upstream gave none
 *    (`likeCount: null` means "unknown", which is not the same as zero).
 *
 * `memo`'d because the list re-renders on every scroll frame the virtualizer
 * drives, and a comment row's props are stable objects straight out of the query
 * cache. Nothing here is stateful.
 */

export interface CommentRowProps {
  comment: Comment;
  depth: 0 | 1;
  /** The video's channel name, for the "Pinned by …" / "Hearted by …" labels. */
  uploaderName: string;
  onSeek: (seconds: number) => void;
}

export const CommentRow = memo(function CommentRow({
  comment,
  depth,
  uploaderName,
  onSeek,
}: CommentRowProps) {
  const avatar = loopbackImage(comment.author.avatarUrl);
  const name = comment.author.name.length > 0 ? comment.author.name : 'Unknown';
  const heartLabel =
    uploaderName.length > 0 ? `Hearted by ${uploaderName}` : 'Hearted by the creator';

  const authorName = (
    <span className="comment__author" data-uploader={comment.authorIsUploader}>
      {name}
    </span>
  );

  return (
    <article className="comment" data-depth={depth}>
      {comment.isPinned && (
        <p className="comment__pinned">
          <Pin size={12} strokeWidth={1.8} aria-hidden="true" />
          {uploaderName.length > 0 ? `Pinned by ${uploaderName}` : 'Pinned'}
        </p>
      )}

      <div className="comment__body">
        {avatar ? (
          <img
            className="comment__avatar"
            src={avatar}
            alt=""
            width={depth === 0 ? 34 : 26}
            height={depth === 0 ? 34 : 26}
            loading="lazy"
          />
        ) : (
          <div className="comment__avatar comment__avatar--fallback" aria-hidden="true" />
        )}

        <div className="comment__main">
          <p className="comment__head">
            {comment.author.id.length > 0 ? (
              <Link
                className="comment__author-link"
                to={`/channel/${encodeURIComponent(comment.author.id)}`}
              >
                {authorName}
              </Link>
            ) : (
              authorName
            )}
            {comment.authorIsVerified && (
              <BadgeCheck
                className="comment__verified"
                size={13}
                strokeWidth={1.8}
                role="img"
                aria-label="Verified"
              />
            )}
            {comment.publishedText && (
              <span className="comment__when tnum">{comment.publishedText}</span>
            )}
          </p>

          <CommentText text={comment.text} timestamps={comment.textTimestamps} onSeek={onSeek} />

          <p className="comment__meta">
            {comment.likeCount !== null && (
              <span className="comment__likes">
                <ThumbsUp size={13} strokeWidth={1.8} aria-hidden="true" />
                <span className="tnum">{formatCompactCount(comment.likeCount)}</span>
              </span>
            )}
            {comment.isHearted && (
              <span className="comment__hearted" role="img" aria-label={heartLabel}>
                <Heart size={13} strokeWidth={1.8} fill="currentColor" aria-hidden="true" />
              </span>
            )}
          </p>
        </div>
      </div>
    </article>
  );
});
