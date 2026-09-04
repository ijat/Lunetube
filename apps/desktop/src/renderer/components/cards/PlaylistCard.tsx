import { Link } from 'react-router-dom';
import { ListVideo } from 'lucide-react';
import { formatCompactCount, type PlaylistRef } from '@lunetube/shared';
import { loopbackImage } from '../../lib/img.js';
import './cards.css';

/**
 * Same visual family as `VideoCard`; the thumb sits under two stacked slivers
 * (`.card__stack`, pure CSS) so a playlist reads as a collection at a glance.
 * Links to `/playlist/:id`, the route P2-9 adds.
 */
export interface PlaylistCardProps {
  playlist: PlaylistRef;
}

export function PlaylistCard({ playlist }: PlaylistCardProps) {
  const thumb = loopbackImage(playlist.thumbnailUrl);

  return (
    <Link className="card card--playlist" to={`/playlist/${encodeURIComponent(playlist.id)}`}>
      <div className="card__stack">
        <div className="card__thumb">
          {thumb && (
            <img className="card__img" src={thumb} alt="" loading="lazy" decoding="async" />
          )}
          <span className="card__sheen" aria-hidden="true" />
          {playlist.videoCount !== null && (
            <span className="card__badge tnum">
              <ListVideo size={11} strokeWidth={2} aria-hidden="true" />
              {formatCompactCount(playlist.videoCount)}
            </span>
          )}
        </div>
      </div>

      <div className="card__text">
        <div className="card__title">{playlist.title}</div>
        <div className="card__meta">
          <span>Playlist</span>
          {playlist.videoCount !== null && (
            <>
              <span className="card__sep" aria-hidden="true">
                ·
              </span>
              <span className="tnum">{formatCompactCount(playlist.videoCount)} videos</span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}
