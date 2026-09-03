import { useSearchParams } from 'react-router-dom';

const TABS: Record<string, string> = {
  following: 'Following',
  history: 'History',
  playlists: 'Playlists',
  watchlater: 'Watch Later',
};

export function LibraryRoute() {
  const [params] = useSearchParams();
  const tab = params.get('tab') ?? 'following';
  return (
    <section className="route">
      <p className="route__kicker">Library</p>
      <h1 className="route__title">{TABS[tab] ?? 'Library'}</h1>
      <p className="route__note">
        The local SQLite library — history, playlists, Watch Later, followed channels and the queue
        — is Phase 3.
      </p>
    </section>
  );
}
