import { Link } from 'react-router-dom';
import { formatCompactCount, formatDuration, type VideoSummary } from '@lunetube/shared';
import { loopbackImage } from '../../lib/img.js';
import './cards.css';

/**
 * The mockup's `.vcard`, Direction B. Consumers lay these out with
 * `minColumnWidth={300} gapX={22} gapY={28}` (mockup
 * `.stage[data-dir="b"] .grid`).
 *
 * It is a `<Link>`, not a `div` with an `onClick`: keyboard focus, Enter, the
 * middle-click/copy-link affordances and the `:focus-visible` ring all come free
 * and none of them can be faked convincingly by hand.
 *
 * Images only ever render when `loopbackImage()` returns a URL. The renderer CSP
 * allows `img-src 'self' data: blob: http://127.0.0.1:*`, so an upstream
 * `https://i.ytimg.com/...` would be blocked and log a console error — which is
 * the *normal* case under `LUNE_FAKE_YT=1`, where the fake source uses an
 * identity rewriter. The fallback is the mockup's own gradient.
 */
export interface VideoCardProps {
  video: VideoSummary;
}

export function VideoCard({ video }: VideoCardProps) {
  const thumb = loopbackImage(video.thumbnailUrl);
  const avatar = loopbackImage(video.channel.avatarUrl);

  return (
    <Link className="card" to={`/watch/${encodeURIComponent(video.id)}`}>
      <div className="card__thumb">
        {thumb && <img className="card__img" src={thumb} alt="" loading="lazy" decoding="async" />}
        <span className="card__sheen" aria-hidden="true" />
        {video.isLive ? (
          <span className="card__badge card__badge--live">LIVE</span>
        ) : (
          video.durationSec !== null && (
            <span className="card__badge tnum">{formatDuration(video.durationSec)}</span>
          )
        )}
      </div>

      <div className="card__body">
        {avatar ? (
          <img className="card__av" src={avatar} alt="" width={30} height={30} loading="lazy" />
        ) : (
          <span className="card__av" aria-hidden="true" />
        )}
        <div className="card__text">
          <div className="card__title">{video.title}</div>
          <div className="card__meta">
            {/* Plain text, not a link to the channel: the whole card is already
                the <Link> and an <a> cannot nest inside another <a> (F4). The
                watch page's WatchMeta channel name carries that link instead. */}
            <span>{video.channel.name || 'Unknown channel'}</span>
            {video.viewCount !== null && (
              <>
                <span className="card__sep" aria-hidden="true">
                  ·
                </span>
                <span className="tnum">{formatCompactCount(video.viewCount)} views</span>
              </>
            )}
            {video.publishedText && (
              <>
                <span className="card__sep" aria-hidden="true">
                  ·
                </span>
                <span className="tnum">{video.publishedText}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
