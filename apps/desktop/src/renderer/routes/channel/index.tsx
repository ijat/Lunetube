import { useParams } from 'react-router-dom';

export function ChannelRoute() {
  const { channelId } = useParams();
  return (
    <section className="route">
      <p className="route__kicker">Channel</p>
      <h1 className="route__title">Channel pages coming in Phase 2</h1>
      <p className="route__note tnum">Channel id: {channelId ?? '—'}.</p>
    </section>
  );
}
