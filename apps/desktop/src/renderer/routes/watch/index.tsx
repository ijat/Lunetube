import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Play } from 'lucide-react';
import { PlayerSurface } from '../../player/PlayerSurface.js';
import type { PlaybackEngine } from '../../player/PlaybackEngine.js';
import { useVideo } from '../../lib/queries.js';
import { loopbackImage } from '../../lib/img.js';
import { useRecentStore } from '../../stores/recentStore.js';
import { WatchMeta } from './WatchMeta.js';
import { DominantColorWash } from './DominantColorWash.js';
import { UpNext } from './UpNext.js';
import { CommentsSection } from './CommentsSection.js';
import './watch.css';

/**
 * Direction B "Cinema" watch page (plan P1-6, completed by P2-10): a full-bleed
 * player, then a meta block padded `26px 30px 0` (title / channel row /
 * description), then the up-next rail, then threaded comments — one immersive
 * column, because direction B hides the right-hand rail.
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

/**
 * `?t=` start-seconds from a shared link. `TopBar` emits `/watch/<id>?t=<n>` for
 * a pasted `youtu.be/ID?t=90` (`map/url.ts#parseStartParam` did the parsing);
 * this is the read side (F3). A positive finite integer, else ignored.
 */
function parseStartParam(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export function WatchRoute() {
  const { videoId } = useParams();
  const [searchParams] = useSearchParams();
  const id = videoId ?? '';
  const startAt = parseStartParam(searchParams.get('t'));
  const { data: detail, error } = useVideo(id);
  const recordVisit = useRecentStore((s) => s.recordVisit);

  // Feed Home's session-scoped "Continue watching" shelf (plan P2-11 / A18).
  // In-memory only — the renderer never owns durable state; Phase 3 swaps this
  // for `db:history`.
  useEffect(() => {
    if (!detail) return;
    recordVisit({
      videoId: detail.id,
      title: detail.title,
      thumbnailUrl: detail.thumbnailUrl,
      channel: detail.channel,
    });
  }, [detail, recordVisit]);

  const [engine, setEngine] = useState<PlaybackEngine | null>(null);
  const [started, setStarted] = useState(false);
  // A timestamp clicked from the poster state (no engine yet), or a `?t=` from a
  // shared link: remembered here and handed to `PlayerSurface` as its initial
  // start time so it is not silently discarded (F3 / F6).
  const pendingSeekRef = useRef<number | null>(null);

  // New video (or a new `?t=`) → back to the poster, seeded with the link's
  // start time if it carried one.
  useEffect(() => {
    setStarted(false);
    setEngine(null);
    pendingSeekRef.current = startAt;
  }, [id, startAt]);

  const handleSeek = useCallback(
    (seconds: number) => {
      if (engine) engine.seek(seconds);
      else {
        pendingSeekRef.current = seconds;
        setStarted(true);
      }
    },
    [engine],
  );

  const poster = loopbackImage(detail?.thumbnailUrl ?? null);

  return (
    <div className="watch">
      {detail && <DominantColorWash videoId={id} thumbnailUrl={detail.thumbnailUrl} />}

      <div className="watch__player">
        {started ? (
          <PlayerSurface
            videoId={id}
            onEngineReady={setEngine}
            {...(poster ? { poster } : {})}
            {...(pendingSeekRef.current != null ? { startTime: pendingSeekRef.current } : {})}
          />
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
          <UpNext videoId={id} />
          {/* Keyed on the video: a new video is a new thread set, so the
              expansion map and every per-thread reply query must start empty
              rather than be reset by an effect after a stale first render
              (CommentsSection invariant I4). */}
          <CommentsSection
            key={id}
            videoId={id}
            uploaderName={detail.channel.name}
            onSeek={handleSeek}
          />
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
