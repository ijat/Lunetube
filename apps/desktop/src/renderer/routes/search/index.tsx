import { useSearchParams } from 'react-router-dom';

export function SearchRoute() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  return (
    <section className="route">
      <p className="route__kicker">Search</p>
      <h1 className="route__title">{q ? `Results for “${q}”` : 'Search'}</h1>
      <p className="route__note">
        Search, filters and rich result cards arrive in Phase 2. The YouTube adapter and media proxy
        (Phase 1) come first.
      </p>
    </section>
  );
}
