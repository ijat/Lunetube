import type { VideoDetail } from '@lunetube/shared';
import { formatCompactCount } from '@lunetube/shared';
import { Button } from '@lunetube/design';
import { ThumbsUp, ThumbsDown, Share2, Bookmark } from 'lucide-react';
import { bridge } from '../../bridge.js';
import { loopbackImage } from '../../lib/img.js';
import { Description } from './Description.js';

/**
 * The meta block under the full-bleed player (plan P1-6 / mockup `.meta`,
 * padded `26px 30px 0` in direction B): title, channel row with Follow +
 * like/dislike + Share + Save, then the description.
 *
 * Phase-1 reality:
 *  - Follow, like/dislike and Save need persistence (Phase 3, SQLite) — they
 *    render disabled with a title note rather than faking a toggled state.
 *  - Share is stateless, so it works now: it opens the canonical `youtu.be`
 *    link in the OS browser through `app:openExternal` (https-only in main).
 *  - `VideoDetail` carries no subscriber count yet (`RawVideoInfo` has
 *    `owner.subscriber_count`; mapping it is Phase 2 alongside channel pages),
 *    so the channel sub-line shows the publish date.
 */

const PHASE3_NOTE = 'Sign-in-free library actions (follow, like, save) arrive in Phase 3.';

function share(videoId: string): void {
  try {
    void bridge()
      .invoke('app:openExternal', { url: `https://youtu.be/${videoId}` })
      .catch(() => undefined);
  } catch {
    /* preload bridge unavailable (unit tests) */
  }
}

export interface WatchMetaProps {
  detail: VideoDetail;
  onSeek: (seconds: number) => void;
}

export function WatchMeta({ detail, onSeek }: WatchMetaProps) {
  const avatar = loopbackImage(detail.channel.avatarUrl);

  return (
    <div className="watch__meta">
      <h1 className="watch__title" data-testid="watch-title">
        {detail.title}
      </h1>

      <div className="watch__subrow">
        <div className="watch__chan">
          {avatar ? (
            <img className="watch__av" src={avatar} alt="" width={42} height={42} loading="lazy" />
          ) : (
            <div className="watch__av watch__av--fallback" aria-hidden="true" />
          )}
          <div>
            <div className="watch__chan-name">{detail.channel.name || 'Unknown channel'}</div>
            {detail.publishedText && (
              <div className="watch__chan-sub tnum">{detail.publishedText}</div>
            )}
          </div>
        </div>

        <Button variant="solid" size="sm" disabled title={PHASE3_NOTE}>
          Follow
        </Button>

        <div className="watch__actions">
          <div className="watch__grp">
            <button
              type="button"
              className="watch__grp-btn"
              disabled
              aria-label="Like"
              title={PHASE3_NOTE}
            >
              <ThumbsUp size={15} strokeWidth={1.8} aria-hidden="true" />
              {detail.likeCount != null && (
                <span className="watch__count tnum">{formatCompactCount(detail.likeCount)}</span>
              )}
            </button>
            <button
              type="button"
              className="watch__grp-btn"
              disabled
              aria-label="Dislike"
              title={PHASE3_NOTE}
            >
              <ThumbsDown size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>

          <button type="button" className="watch__act-btn" onClick={() => share(detail.id)}>
            <Share2 size={15} strokeWidth={1.8} aria-hidden="true" />
            Share
          </button>

          <button type="button" className="watch__act-btn" disabled title={PHASE3_NOTE}>
            <Bookmark size={15} strokeWidth={1.8} aria-hidden="true" />
            Save
          </button>
        </div>
      </div>

      <Description detail={detail} onSeek={onSeek} />
    </div>
  );
}
