import { BadgeCheck } from 'lucide-react';
import { Button } from '@lunetube/design';
import type { ChannelDetail } from '@lunetube/shared';
import { loopbackImage } from '../../lib/img.js';

/**
 * The channel page header (plan P2-9): banner + 72px avatar + name + handle /
 * subscriber count + a disabled Follow button. Content surface, not chrome
 * (ARCHITECTURE.md "Window materials / glass") — the avatar row is one
 * `.glass-panel` blur layer; the banner is a plain image with no glass
 * treatment of its own.
 *
 * Follow needs the Phase-3 follows table (SQLite) — same rationale as
 * `watch/WatchMeta.tsx`'s disabled Follow/like/Save: a button that silently
 * does nothing is worse than one that says so.
 */
const FOLLOW_NOTE = 'Following arrives in Phase 3';

export interface ChannelHeaderProps {
  channel: ChannelDetail;
}

export function ChannelHeader({ channel }: ChannelHeaderProps) {
  const banner = loopbackImage(channel.bannerUrl);
  const avatar = loopbackImage(channel.avatarUrl);

  return (
    <header className="chan-header">
      {/* Collapses to nothing (never a broken image) when there is no
       * loopback-proxied banner — the transparent stage's own backdrop shows
       * through instead. */}
      {banner && (
        <div className="chan-header__banner">
          <img src={banner} alt="" loading="lazy" decoding="async" />
        </div>
      )}

      <div className="chan-header__row glass-panel">
        {avatar ? (
          <img
            className="chan-header__avatar"
            src={avatar}
            alt=""
            width={72}
            height={72}
            loading="lazy"
          />
        ) : (
          <span className="chan-header__avatar" aria-hidden="true" />
        )}

        <div className="chan-header__meta">
          <h1 className="chan-header__name display">
            {channel.name || 'Unknown channel'}
            {channel.isVerified && (
              <BadgeCheck
                className="chan-header__verified"
                size={16}
                strokeWidth={2}
                role="img"
                aria-label="Verified"
              />
            )}
          </h1>
          <p className="chan-header__sub tnum">
            {channel.handle && <span>{channel.handle}</span>}
            {channel.handle && channel.subscriberText && <span aria-hidden="true">·</span>}
            {channel.subscriberText && <span>{channel.subscriberText}</span>}
          </p>
        </div>

        <Button variant="solid" size="sm" disabled title={FOLLOW_NOTE}>
          Follow
        </Button>
      </div>
    </header>
  );
}
