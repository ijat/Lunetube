import { useParams } from 'react-router-dom';

export function WatchRoute() {
  const { videoId } = useParams();
  return (
    <section className="route">
      <p className="route__kicker">Watch</p>
      <h1 className="route__title">Player coming in Phase 1</h1>
      <p className="route__note tnum">
        Video id: {videoId ?? '—'}. The shaka-based player, DASH manifest and loopback media proxy
        are Phase 1 work.
      </p>
    </section>
  );
}
