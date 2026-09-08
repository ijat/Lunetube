import { Fragment, useMemo, type ReactNode } from 'react';
import { parseTimestampsFromText, type ChannelAbout } from '@lunetube/shared';
import { bridge } from '../../bridge.js';
import { renderRichText } from '../../lib/richText.js';

/**
 * The channel About tab (plan P2-9). The description gets the same
 * timestamp/link treatment as `watch/Description.tsx` (PRD §3.1) via the shared
 * `lib/richText` helper — but with **no `onSeek`**, so timestamps render as
 * inert spans: there is no player on this route to seek, and a dead button is
 * worse than a plain span (same reasoning as the disabled Follow button).
 * `ChannelAbout.description` carries no pre-parsed timestamps the way
 * `VideoDetail` does, so they're found here with the `@lunetube/shared` helper
 * the video adapter uses server-side.
 *
 * `about.subscriberText` / `videoCountText` / `viewCountText` / `joinedText`
 * are already human-formatted upstream text (e.g. `"1.2B views"`, `"Joined
 * Feb 9, 2015"`) — rendered as-is, never re-labelled.
 *
 * The explicit `about.links` list opens through `app:openExternal` (https-only
 * in main); `map/channel.ts#linkUrl` already normalises each URL to https or
 * drops it (S4), so a dead button is not offered.
 */

function openExternal(url: string): void {
  try {
    void bridge()
      .invoke('app:openExternal', { url })
      .catch(() => undefined);
  } catch {
    /* preload bridge unavailable (unit tests) */
  }
}

export interface AboutTabProps {
  about: ChannelAbout;
}

export function AboutTab({ about }: AboutTabProps) {
  const rendered = useMemo<ReactNode[]>(
    () =>
      renderRichText(about.description, parseTimestampsFromText(about.description), {
        timestampClassName: 'chan-about__ts tnum',
        linkClassName: 'chan-about__link',
      }),
    [about.description],
  );

  const stats = [
    about.subscriberText,
    about.videoCountText,
    about.viewCountText,
    about.joinedText,
    about.country,
  ].filter((s): s is string => Boolean(s));

  return (
    <div className="chan-about">
      {stats.length > 0 && (
        <p className="chan-about__stats tnum">
          {stats.map((s, i) => (
            <Fragment key={s}>
              {i > 0 && <span aria-hidden="true">·</span>}
              <span>{s}</span>
            </Fragment>
          ))}
        </p>
      )}

      {rendered.length > 0 && <div className="chan-about__desc glass-panel">{rendered}</div>}

      {about.links.length > 0 && (
        <div className="chan-about__links">
          {about.links.map((link, i) => (
            <button
              type="button"
              key={`${i}-${link.url}`}
              className="chan-about__link"
              onClick={() => openExternal(link.url)}
            >
              {link.title || link.url}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
