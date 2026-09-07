import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ListVideo } from 'lucide-react';
import { formatCompactCount, formatDuration, type VideoSummary } from '@lunetube/shared';
import { ErrorState } from '../../components/ErrorState.js';
import { loopbackImage } from '../../lib/img.js';
import { useRelated } from '../../lib/queries.js';
import './comments.css';

/**
 * The "Up next" rail (plan P2-10). Direction B is a single immersive column —
 * the mockup hides the right-hand rail — so related videos stack under the
 * description as a compact horizontal card list.
 *
 * **No "Load more".** `yt:related` is single-page by A13:
 * `VideoInfo.getWatchNextContinuation()` returns `this` after replacing
 * `watch_next_feed` in place, so any handle over it advances a hidden cursor on
 * retry, back-navigation or a StrictMode double-invoke. The pagination was
 * removed rather than patched, and `useRelated` is a plain `useQuery` — there is
 * no `fetchNextPage` to call here.
 *
 * **No autoplay toggle.** Autoplay-next needs the queue, which is Phase 3. A
 * toggle that flips a flag nothing reads is worse than no toggle.
 *
 * Rows are `<Link>`s for the same reasons `VideoCard` is, and images only render
 * when `loopbackImage()` returns a loopback-proxy URL — under `LUNE_FAKE_YT=1`
 * it returns `null` and the gradient placeholder shows instead, so nothing in
 * this component can trip the renderer CSP.
 */

function UpNextRow({ video }: { video: VideoSummary }) {
  const thumb = loopbackImage(video.thumbnailUrl);

  return (
    <Link className="upnext__row" to={`/watch/${encodeURIComponent(video.id)}`}>
      <span className="upnext__thumb">
        {thumb && (
          <img className="upnext__img" src={thumb} alt="" loading="lazy" decoding="async" />
        )}
        {video.isLive ? (
          <span className="upnext__badge upnext__badge--live">LIVE</span>
        ) : (
          video.durationSec !== null && (
            <span className="upnext__badge tnum">{formatDuration(video.durationSec)}</span>
          )
        )}
      </span>

      <span className="upnext__text">
        <span className="upnext__title">{video.title}</span>
        <span className="upnext__meta">
          <span>{video.channel.name || 'Unknown channel'}</span>
          {video.viewCount !== null && (
            <>
              <span aria-hidden="true"> · </span>
              <span className="tnum">{formatCompactCount(video.viewCount)} views</span>
            </>
          )}
          {video.publishedText && (
            <>
              <span aria-hidden="true"> · </span>
              <span className="tnum">{video.publishedText}</span>
            </>
          )}
        </span>
      </span>
    </Link>
  );
}

export interface UpNextProps {
  videoId: string;
}

export function UpNext({ videoId }: UpNextProps) {
  const { data, status, error, refetch } = useRelated(videoId);

  // The row key is the video id, so a feed that repeats one would produce two
  // React siblings with the same key. Cheap to rule out; expensive to debug.
  const items = useMemo<VideoSummary[]>(() => {
    const seen = new Set<string>();
    return (data?.items ?? []).filter((v) => {
      if (v.id.length === 0 || seen.has(v.id)) return false;
      seen.add(v.id);
      return true;
    });
  }, [data]);

  return (
    <section className="upnext" aria-labelledby="upnext-title">
      <h2 id="upnext-title" className="watch__section-title">
        <ListVideo size={16} strokeWidth={1.8} aria-hidden="true" />
        Up next
      </h2>

      {status === 'pending' ? (
        <div className="upnext__list" aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="upnext__row upnext__row--skeleton">
              <span className="upnext__thumb" />
              <span className="upnext__text">
                <span className="upnext__skel upnext__skel--title" />
                <span className="upnext__skel" />
              </span>
            </div>
          ))}
        </div>
      ) : status === 'error' ? (
        <ErrorState
          message={error.message}
          {...(error.hint ? { hint: error.hint } : {})}
          {...(error.retryable ? { onRetry: () => void refetch() } : {})}
        />
      ) : items.length === 0 ? (
        <p className="watch__section-note">Nothing related to show for this video.</p>
      ) : (
        <div className="upnext__list">
          {items.map((video) => (
            <UpNextRow key={video.id} video={video} />
          ))}
        </div>
      )}
    </section>
  );
}
