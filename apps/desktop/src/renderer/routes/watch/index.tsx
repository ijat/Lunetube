import { useParams } from 'react-router-dom';
import { useVideo } from '../../lib/queries.js';

/**
 * Scaffolding only — P1-6 replaces this with the real Direction-B watch page
 * (full-bleed player, meta block, description, dominant-colour wash). For P1-4
 * it exists to prove the renderer query layer end to end: `useVideo` → `yt:video`
 * IPC → `YouTubeSource` → a rendered title.
 */
export function WatchRoute() {
  const { videoId } = useParams();
  const id = videoId ?? '';
  const { data, error, isPending } = useVideo(id);

  const heading = data
    ? data.title
    : error
      ? 'Could not load this video'
      : isPending && id
        ? 'Loading…'
        : 'No video';

  return (
    <section className="route">
      <p className="route__kicker">Watch</p>
      <h1 className="route__title" data-testid="watch-title">
        {heading}
      </h1>
      <p className="route__note tnum">
        Video id: {id || '—'}. Player, DASH manifest and loopback media proxy land in P1-5 / P1-6.
      </p>
    </section>
  );
}
