import { type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@lunetube/design';
import type { VideoSummary } from '@lunetube/shared';
import { VideoCard } from '../../components/cards/index.js';
import { VirtualGrid } from '../../components/VirtualGrid.js';
import { useRelated } from '../../lib/queries.js';
import { recentToSummary, useRecentStore } from '../../stores/recentStore.js';
import './home.css';

/**
 * Home (decision A1 / A18). LuneTube has **no algorithmic home feed** —
 * `getHomeFeed()` is empty anonymously — so Home is composed locally:
 *
 *  1. a **search-first hero** — the whole page on a fresh install, because
 *     search is the only way in;
 *  2. **Continue watching** — from `recentStore`, an in-memory session-scoped
 *     store the watch route pushes into. It is deliberately not persisted (the
 *     renderer never owns durable state); Phase 3 swaps the source to
 *     `db:history` with no layout change, and the shelf says so until then;
 *  3. **Because you watched "<title>"** — `useRelated` on the most recent
 *     video, the one dynamic shelf Phase 2 can actually fill;
 *  4. **Latest from followed** — a labelled Phase-3 placeholder, never faked
 *     (the follows table does not exist and the fan-out has its own
 *     rate-limiting design).
 */

/** 16:9 thumb at the 300px minimum column width, plus the card body (matches P2-8). */
const ESTIMATE_ROW_HEIGHT = Math.round((300 * 9) / 16) + 78;

function focusTopBarSearch(): void {
  document.getElementById('topbar-search')?.focus();
}

function Shelf({
  title,
  note,
  items,
  ariaLabel,
}: {
  title: string;
  note?: string;
  items: VideoSummary[];
  ariaLabel: string;
}): ReactNode {
  return (
    <section className="home__shelf">
      <h2 className="home__shelf-title">{title}</h2>
      {note && <p className="home__shelf-note">{note}</p>}
      <VirtualGrid
        items={items}
        renderItem={(video) => <VideoCard video={video} />}
        minColumnWidth={300}
        gapX={22}
        gapY={28}
        estimateRowHeight={ESTIMATE_ROW_HEIGHT}
        ariaLabel={ariaLabel}
      />
    </section>
  );
}

export function HomeRoute() {
  const recents = useRecentStore((s) => s.recents);
  const mostRecent = recents[0];
  // Hook is always called; `useRelated` is disabled for an empty id.
  const related = useRelated(mostRecent?.videoId ?? '');

  if (recents.length === 0) {
    return (
      <section className="home home--hero">
        <p className="route__kicker">LuneTube</p>
        <h1 className="home__hero-title">Search, then watch.</h1>
        <p className="home__hero-sub">
          There is no algorithmic feed here. Type in the bar above — or press the button — and go.
        </p>
        <Button variant="surface" onClick={focusTopBarSearch}>
          <Search size={16} strokeWidth={1.8} aria-hidden="true" />
          Search YouTube
        </Button>
      </section>
    );
  }

  const becauseItems = related.data?.items ?? [];

  return (
    <section className="home">
      <p className="route__kicker">Home</p>

      <Shelf
        title="Continue watching"
        note="Session only — this shelf clears when you quit, until watch history lands in Phase 3."
        items={recents.map(recentToSummary)}
        ariaLabel="Continue watching"
      />

      {mostRecent && becauseItems.length > 0 && (
        <Shelf
          title={`Because you watched “${mostRecent.title}”`}
          items={becauseItems}
          ariaLabel={`Related to ${mostRecent.title}`}
        />
      )}

      <section className="home__shelf home__shelf--placeholder">
        <h2 className="home__shelf-title">Latest from followed</h2>
        <p className="home__shelf-note">
          Following channels and a feed of their latest uploads arrive in Phase 3.
        </p>
      </section>
    </section>
  );
}
