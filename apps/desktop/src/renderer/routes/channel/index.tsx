import { useCallback, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Button, Skeleton } from '@lunetube/design';
import type { ChannelTab, PlaylistRef, VideoSummary } from '@lunetube/shared';
import { CardSkeleton, PlaylistCard, VideoCard } from '../../components/cards/index.js';
import { EmptyState } from '../../components/EmptyState.js';
import { ErrorState } from '../../components/ErrorState.js';
import { VirtualGrid } from '../../components/VirtualGrid.js';
import { useInfiniteScrollSentinel } from '../../components/useInfiniteScrollSentinel.js';
import { isStaleContinuation, useChannel } from '../../lib/queries.js';
import { AboutTab } from './AboutTab.js';
import { ChannelHeader } from './ChannelHeader.js';
import { ChannelTabs } from './ChannelTabs.js';
import './channel.css';

/**
 * Channel route (plan P2-9): `/channel/:channelId?tab=videos|shorts|
 * playlists|about|live|podcasts`. **The URL is the source of truth for the
 * active tab** — switching tabs pushes a new history entry (not `replace`),
 * so a tab is linkable and back/forward moves between tabs, and it keys a
 * brand-new `useChannel(channelId, tab)` query rather than mutating the
 * current one (a different `ChannelTab` is a different cache entry by
 * construction, per `ytKeys.channel`).
 *
 * **Header persistence across continuations (A16):** a continuation page's
 * `channel` is `undefined` by design — the DTO discriminant only carries a
 * header on page 1. The header is therefore always read off
 * `data.pages[0]?.channel`, never the latest page, so it never flickers or
 * blanks while paging through a tab.
 */

const CHANNEL_TABS: readonly ChannelTab[] = [
  'videos',
  'shorts',
  'playlists',
  'about',
  'live',
  'podcasts',
];

const TAB_LABELS: Record<ChannelTab, string> = {
  videos: 'videos',
  shorts: 'shorts',
  playlists: 'playlists',
  about: 'about',
  live: 'live streams',
  podcasts: 'podcasts',
};

function isMember<T extends string>(value: string | null, set: readonly T[]): value is T {
  return value !== null && (set as readonly string[]).includes(value);
}

function parseTab(params: URLSearchParams): ChannelTab {
  const tab = params.get('tab');
  return isMember(tab, CHANNEL_TABS) ? tab : 'videos';
}

/** 16:9 thumb at the 300px minimum column width, plus the card body (P2-8). */
const VIDEO_ROW_HEIGHT = Math.round((300 * 9) / 16) + 78;
/** Shorts get a 9:16 thumb variant instead (`.channel__shorts-cell`). */
const SHORTS_ROW_HEIGHT = Math.round((300 * 16) / 9) + 78;

export function ChannelRoute() {
  const { channelId: rawChannelId } = useParams();
  const channelId = rawChannelId ?? '';
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params);

  const setTab = useCallback(
    (next: ChannelTab) => {
      const nextParams = new URLSearchParams(params);
      nextParams.set('tab', next);
      setParams(nextParams);
    },
    [params, setParams],
  );

  const result = useChannel(channelId, tab);
  const { hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = result;

  const sentinelRef = useInfiniteScrollSentinel(() => void fetchNextPage());

  if (!channelId) {
    return (
      <section className="channel">
        <p className="route__kicker">Channel</p>
        <h1 className="route__title">Channel</h1>
        <p className="route__note">No channel id.</p>
      </section>
    );
  }

  const page1 = result.data?.pages[0];
  const channel = page1?.channel;

  /** Shared "grid + load more / continuation-error" tail for both list-shaped
   * tab kinds ('videos' — used by videos/shorts/live/podcasts — and
   * 'playlists'). Closes over `result` / `hasNextPage` / etc. above. */
  const pagedGrid = <T,>(
    items: T[],
    renderItem: (item: T) => ReactNode,
    emptyTitle: string,
    rowHeight: number,
    ariaLabel: string,
  ): ReactNode => {
    if (items.length === 0) return <EmptyState title={emptyTitle} />;
    return (
      <>
        <VirtualGrid
          items={items}
          renderItem={renderItem}
          minColumnWidth={300}
          gapX={22}
          gapY={28}
          estimateRowHeight={rowHeight}
          ariaLabel={ariaLabel}
        />
        <div className="channel__more">
          {result.status === 'error' ? (
            isStaleContinuation(result.error) ? (
              <ErrorState
                message="This list refreshed."
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
              <div ref={sentinelRef} className="channel__sentinel" aria-hidden="true" />
            </>
          ) : null}
        </div>
      </>
    );
  };

  let content: ReactNode;
  if (result.status === 'pending') {
    content = (
      <div className="channel__grid" aria-hidden="true">
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
  } else if (page1?.content.kind === 'about') {
    content = <AboutTab about={page1.content.about} />;
  } else if (page1?.content.kind === 'playlists') {
    const items: PlaylistRef[] =
      result.data?.pages.flatMap((p) => (p.content.kind === 'playlists' ? p.content.items : [])) ??
      [];
    content = pagedGrid(
      items,
      (playlist) => <PlaylistCard playlist={playlist} />,
      'No playlists yet',
      VIDEO_ROW_HEIGHT,
      `Playlists on ${channel?.name ?? 'this channel'}`,
    );
  } else {
    const isShorts = tab === 'shorts';
    const items: VideoSummary[] =
      result.data?.pages.flatMap((p) => (p.content.kind === 'videos' ? p.content.items : [])) ?? [];
    content = pagedGrid(
      items,
      (video) =>
        isShorts ? (
          <div className="channel__shorts-cell">
            <VideoCard video={video} />
          </div>
        ) : (
          <VideoCard video={video} />
        ),
      `No ${TAB_LABELS[tab]} yet`,
      isShorts ? SHORTS_ROW_HEIGHT : VIDEO_ROW_HEIGHT,
      `${TAB_LABELS[tab]} on ${channel?.name ?? 'this channel'}`,
    );
  }

  return (
    <section className="channel">
      {channel ? (
        <>
          <ChannelHeader channel={channel} />
          <ChannelTabs availableTabs={channel.availableTabs} activeTab={tab} onChange={setTab} />
        </>
      ) : (
        result.status === 'pending' && (
          <div className="chan-header" aria-hidden="true">
            <div className="chan-header__row glass-panel">
              <Skeleton width={72} height={72} radius="50%" />
              <div className="chan-header__meta" style={{ display: 'grid', gap: 8 }}>
                <Skeleton width="40%" height={20} />
                <Skeleton width="24%" height={12} />
              </div>
            </div>
          </div>
        )
      )}
      {content}
    </section>
  );
}
