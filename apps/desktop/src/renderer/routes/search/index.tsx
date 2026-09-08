import { useCallback, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Chip } from '@lunetube/design';
import {
  DEFAULT_SEARCH_FILTERS,
  type SearchDuration,
  type SearchFilters,
  type SearchResultItem,
  type SearchResultType,
  type SearchSort,
  type SearchUploadDate,
} from '@lunetube/shared';
import {
  CardSkeleton,
  ChannelCard,
  PlaylistCard,
  VideoCard,
} from '../../components/cards/index.js';
import { EmptyState } from '../../components/EmptyState.js';
import { ErrorState } from '../../components/ErrorState.js';
import { VirtualGrid } from '../../components/VirtualGrid.js';
import { useInfiniteScrollSentinel } from '../../components/useInfiniteScrollSentinel.js';
import { isStaleContinuation, useSearch } from '../../lib/queries.js';
import { activeFilterEntries, SearchFilterBar } from './SearchFilterBar.js';
import './search.css';

/**
 * Search route (plan P2-8). **The URL is the source of truth** —
 * `?q=&sort=&date=&dur=&type=` — so a reload reproduces the exact result set
 * and back/forward works. Unknown/invalid params fall back to
 * `DEFAULT_SEARCH_FILTERS` per field (`parseFilters` below).
 */

const SEARCH_SORTS: readonly SearchSort[] = ['relevance', 'views'];
const SEARCH_UPLOAD_DATES: readonly SearchUploadDate[] = ['any', 'today', 'week', 'month', 'year'];
const SEARCH_DURATIONS: readonly SearchDuration[] = ['any', 'short', 'medium', 'long'];
const SEARCH_RESULT_TYPES: readonly SearchResultType[] = ['all', 'video', 'channel', 'playlist'];

function isMember<T extends string>(value: string | null, set: readonly T[]): value is T {
  return value !== null && (set as readonly string[]).includes(value);
}

function parseFilters(params: URLSearchParams): SearchFilters {
  const sort = params.get('sort');
  const date = params.get('date');
  const dur = params.get('dur');
  const type = params.get('type');
  return {
    sort: isMember(sort, SEARCH_SORTS) ? sort : DEFAULT_SEARCH_FILTERS.sort,
    uploadDate: isMember(date, SEARCH_UPLOAD_DATES) ? date : DEFAULT_SEARCH_FILTERS.uploadDate,
    duration: isMember(dur, SEARCH_DURATIONS) ? dur : DEFAULT_SEARCH_FILTERS.duration,
    type: isMember(type, SEARCH_RESULT_TYPES) ? type : DEFAULT_SEARCH_FILTERS.type,
  };
}

/** 16:9 thumb at the 300px minimum column width, plus the card body (P2-8). */
const ESTIMATE_ROW_HEIGHT = Math.round((300 * 9) / 16) + 78;

function renderResultItem(item: SearchResultItem): ReactNode {
  switch (item.kind) {
    case 'video':
      return <VideoCard video={item.video} />;
    case 'channel':
      return <ChannelCard channel={item.channel} />;
    case 'playlist':
      return <PlaylistCard playlist={item.playlist} />;
  }
}

export function SearchRoute() {
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') ?? '').trim();
  const filters = parseFilters(params);

  const setFilters = useCallback(
    (next: SearchFilters) => {
      const nextParams = new URLSearchParams(params);
      nextParams.set('sort', next.sort);
      nextParams.set('date', next.uploadDate);
      nextParams.set('dur', next.duration);
      nextParams.set('type', next.type);
      setParams(nextParams, { replace: true });
    },
    [params, setParams],
  );

  const result = useSearch(q, filters);
  const { hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = result;

  const sentinelRef = useInfiniteScrollSentinel(() => void fetchNextPage());

  if (!q) {
    return (
      <section className="search">
        <p className="route__kicker">Search</p>
        <h1 className="route__title">Search</h1>
        <p className="route__note">Type in the bar above to search YouTube.</p>
      </section>
    );
  }

  const items = result.data?.pages.flatMap((page) => page.items) ?? [];

  let content: ReactNode;
  if (result.status === 'pending') {
    content = (
      <div className="search__grid" aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    );
  } else if (result.status === 'error' && result.data === undefined) {
    const { error } = result;
    content = (
      <ErrorState
        message={error.message}
        {...(error.hint ? { hint: error.hint } : {})}
        {...(error.retryable ? { onRetry: () => void refetch() } : {})}
      />
    );
  } else if (items.length === 0) {
    const active = activeFilterEntries(filters);
    content = (
      <EmptyState
        title={`No results for "${q}"`}
        hint="Try different words, or clear a filter below."
        {...(active.length > 0
          ? {
              action: (
                <div className="search__active-filters">
                  {active.map((entry) => (
                    <Chip
                      key={entry.field}
                      className="f"
                      onClick={() => setFilters(entry.reset(filters))}
                    >
                      {entry.label} ✕
                    </Chip>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setFilters(DEFAULT_SEARCH_FILTERS)}
                  >
                    Clear all filters
                  </Button>
                </div>
              ),
            }
          : {})}
      />
    );
  } else {
    content = (
      <>
        <VirtualGrid
          items={items}
          renderItem={renderResultItem}
          minColumnWidth={300}
          gapX={22}
          gapY={28}
          estimateRowHeight={ESTIMATE_ROW_HEIGHT}
          ariaLabel={`Search results for ${q}`}
        />
        <div className="search__more">
          {result.status === 'error' ? (
            isStaleContinuation(result.error) ? (
              <ErrorState
                message="This search refreshed."
                hint="Reload to keep browsing."
                onRetry={() => void refetch()}
              />
            ) : (
              <ErrorState
                message={result.error.message}
                {...(result.error.hint ? { hint: result.error.hint } : {})}
                {...(result.error.retryable ? { onRetry: () => void fetchNextPage() } : {})}
              />
            )
          ) : hasNextPage ? (
            <>
              <Button
                variant="surface"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
              <div ref={sentinelRef} className="search__sentinel" aria-hidden="true" />
            </>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <section className="search">
      <header className="search__head">
        <p className="route__kicker">Search</p>
        <h1 className="route__title">Results for “{q}”</h1>
        <SearchFilterBar filters={filters} onChange={setFilters} />
      </header>
      {content}
    </section>
  );
}
