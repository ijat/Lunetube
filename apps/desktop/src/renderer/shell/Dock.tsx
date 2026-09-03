import { useLocation } from 'react-router-dom';
import { ListVideo } from 'lucide-react';
import { useVideo } from '../lib/queries.js';
import { loopbackImage } from '../lib/img.js';

const WATCH_PATH = /^\/watch\/([^/]+)/;

/**
 * Bottom now-playing dock (mockup L495-512). In Phase 1 it mirrors the current
 * watch route's video — title, channel and mini thumbnail, all from the same
 * cached `useVideo` query the page already ran. Queue, transport controls and
 * "up next" wiring arrive with the queue store in Phase 3.
 */
export function Dock() {
  const match = WATCH_PATH.exec(useLocation().pathname);
  const videoId = match?.[1] ?? '';
  const { data } = useVideo(videoId);

  const thumb = loopbackImage(data?.thumbnailUrl ?? null);

  return (
    <footer className="dock glass-root" aria-label="Now playing">
      {thumb ? (
        <img className="dock__mini" src={thumb} alt="" width={92} height={52} />
      ) : (
        <div className="dock__mini" aria-hidden="true" />
      )}
      <div className="dock__meta">
        <div className="dock__title">{data?.title ?? 'Nothing playing yet'}</div>
        <div className="dock__sub tnum">
          {data
            ? data.channel.name || 'Unknown channel'
            : 'Queue and now-playing controls arrive in Phase 3'}
        </div>
      </div>
      <div className="dock__upnext">
        <ListVideo size={18} strokeWidth={1.8} aria-hidden="true" />
      </div>
    </footer>
  );
}
