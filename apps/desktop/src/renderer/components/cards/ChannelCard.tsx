import { Link } from 'react-router-dom';
import { BadgeCheck } from 'lucide-react';
import { formatCompactCount, type ChannelDetail } from '@lunetube/shared';
import { loopbackImage } from '../../lib/img.js';
import './cards.css';

/**
 * Same visual family as `VideoCard` — the hover lift and glow move to a round
 * 88px avatar instead of a 16:9 thumb. Takes the `ChannelDetail` a mixed search
 * page yields (`SearchResultItem { kind: 'channel' }`).
 */
export interface ChannelCardProps {
  channel: ChannelDetail;
}

export function ChannelCard({ channel }: ChannelCardProps) {
  const avatar = loopbackImage(channel.avatarUrl);

  return (
    <Link className="card card--channel" to={`/channel/${encodeURIComponent(channel.id)}`}>
      {avatar ? (
        <img
          className="card__av card__av--lg"
          src={avatar}
          alt=""
          width={88}
          height={88}
          loading="lazy"
        />
      ) : (
        <span className="card__av card__av--lg" aria-hidden="true" />
      )}
      <div className="card__text">
        <div className="card__title">
          {channel.name || 'Unknown channel'}
          {channel.isVerified && (
            <>
              {' '}
              <BadgeCheck
                className="card__verified"
                size={13}
                strokeWidth={2}
                role="img"
                aria-label="Verified"
              />
            </>
          )}
        </div>
        <div className="card__meta">
          {channel.handle && <span>{channel.handle}</span>}
          {channel.subscriberText && (
            <>
              {channel.handle && (
                <span className="card__sep" aria-hidden="true">
                  ·
                </span>
              )}
              <span className="tnum">{channel.subscriberText}</span>
            </>
          )}
          {channel.videoCount !== null && (
            <>
              <span className="card__sep" aria-hidden="true">
                ·
              </span>
              <span className="tnum">{formatCompactCount(channel.videoCount)} videos</span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}
