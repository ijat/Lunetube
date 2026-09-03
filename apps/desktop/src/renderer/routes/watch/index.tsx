import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Play } from 'lucide-react';
import { PlayerSurface } from '../../player/PlayerSurface.js';
import type { PlaybackEngine } from '../../player/PlaybackEngine.js';
import { useVideo } from '../../lib/queries.js';
import { loopbackImage } from '../../lib/img.js';
import { WatchMeta } from './WatchMeta.js';
import { DominantColorWash } from './DominantColorWash.js';
import { RelatedPlaceholder } from './RelatedPlaceholder.js';
import './watch.css';

/**
 * Direction B "Cinema" watch page (plan P1-6): a full-bleed player, then a meta
 * block padded `26px 30px 0`, then the Phase-2 comments / related placeholders.
 * The living backdrop is re-tinted from the thumbnail's dominant colours.
 *
 * **The player mounts on the first play click, not on route entry.** Under
 * `LUNE_FAKE_YT=1` the fixture's googlevideo URLs are long expired, so an
 * auto-mounted `<PlayerSurface>` would have shaka fail every segment and the
 * CSP would reject the `https:` media host — both emit console errors and break
 * `watch.spec.ts`'s zero-console-errors gate. Deferring the mount behind a user
 * gesture keeps the e2e path network-free *and* is sound product behaviour: it
 * shows the poster first and sidesteps Chromium's autoplay policy. (P1-5 left
 * this exact trade-off to P1-6.)
 */
export function WatchRoute() {
  const { videoId } = useParams();
  const id = videoId ?? '';
  const { data: detail, error } = useVideo(id);

  const [engine, setEngine] = useState<PlaybackEngine | null>(null);
  const [started, setStarted] = useState(false);

  // New video → back to the poster.
  useEffect(() => {
    setStarted(false);
    setEngine(null);
  }, [id]);

  const handleSeek = useCallback(
    (seconds: number) => {
      if (engine) engine.seek(seconds);
      else setStarted(true);
    },
    [engine],
  );

  const poster = loopbackImage(detail?.thumbnailUrl ?? null);

  return (
    <div className="watch">
      {detail && <DominantColorWash videoId={id} thumbnailUrl={detail.thumbnailUrl} />}

      <div className="watch__player">
        {started ? (
          <PlayerSurface videoId={id} onEngineReady={setEngine} {...(poster ? { poster } : {})} />
        ) : (
          <button
            type="button"
            className="watch__poster"
            onClick={() => setStarted(true)}
            disabled={!detail && !error}
            aria-label={detail ? `Play ${detail.title}` : 'Play'}
          >
            {poster && <img className="watch__poster-img" src={poster} alt="" />}
            <span className="watch__poster-play" aria-hidden="true">
              <Play size={30} strokeWidth={1.8} />
            </span>
          </button>
        )}
      </div>

      {detail ? (
        <>
          <WatchMeta detail={detail} onSeek={handleSeek} />
          <RelatedPlaceholder />
        </>
      ) : (
        <div className="watch__meta">
          <p className="route__note">
            {error ? 'Could not load this video.' : id ? 'Loading…' : 'No video selected.'}
          </p>
        </div>
      )}
    </div>
  );
}
