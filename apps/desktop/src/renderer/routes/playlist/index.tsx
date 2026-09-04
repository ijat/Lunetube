import { useCallback, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, Skeleton } from '@lunetube/design';
import { formatCompactCount, formatDuration, type VideoSummary } from '@lunetube/shared';
import { EmptyState } from '../../components/EmptyState.js';
import { ErrorState } from '../../components/ErrorState.js';
import { VirtualList } from '../../components/VirtualList.js';
import { loopbackImage } from '../../lib/img.js';
import { isStaleContinuation, usePlaylist } from '../../lib/queries.js';
import './playlist.css';

/**
 * Playlist route (plan P2-9): `/playlist/:playlistId` — a header (thumb,
 * title, author, video count, last-updated) over a `VirtualList` of numbered
 * rows. No "Play all" — it needs the Phase-3 queue; a button that could not
 * actually queue anything would be a dead affordance.
 *
 * **Header persistence across continuations (P2-4):** `Playlist.info` is
 * only real on the first page — a continuation response carries no header at
 * all, and `mapPlaylistDetail` degrades every header field to empty/`null`
 * for it. The header is therefore always read off `data.pages[0]`, never the
 * latest page, so it never blanks out while paging through the list.
 */

const ROW_ESTIMATE = 92;

function PlaylistRow({ index, video }: { index: number; video: VideoSummary }) {
  const thumb = loopbackImage(video.thumbnailUrl);
  return (
    <Link className="playlist-row" to={`/watch/${encodeURIComponent(video.id)}`}>
      <span className="playlist-row__index tnum" aria-hidden="true">
        {index + 1}
      </span>
      <div className="playlist-row__thumb">
        {thumb && <img src={thumb} alt="" loading="lazy" decoding="async" />}
        {video.isLive ? (
          <span className="playlist-row__badge playlist-row__badge--live">LIVE</span>
        ) : (
          video.durationSec !== null && (
            <span className="playlist-row__badge tnum">{formatDuration(video.durationSec)}</span>
          )
        )}
      </div>
      <div className="playlist-row__text">
        <div className="playlist-row__title">{video.title}</div>
        <div className="playlist-row__meta">
          <span>{video.channel.name || 'Unknown channel'}</span>
          {video.viewCount !== null && (
            <>
              <span aria-hidden="true">·</span>
              <span className="tnum">{formatCompactCount(video.viewCount)} views</span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}

export function PlaylistRoute() {
  const { playlistId: rawPlaylistId } = useParams();
  const playlistId = rawPlaylistId ?? '';
  const result = usePlaylist(playlistId);
  const { hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = result;

  // Callback ref, same idiom as `search/index.tsx` / `channel/index.tsx`.
  const sentinelRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el || typeof IntersectionObserver === 'undefined') return undefined;
      const observer = new IntersectionObserver((entries) => {
        if (entries[0]?.isIntersecting) void fetchNextPage();
      });
      observer.observe(el);
      return () => observer.disconnect();
    },
    [fetchNextPage],
  );

  if (!playlistId) {
    return (
      <section className="playlist">
        <p className="route__kicker">Playlist</p>
        <h1 className="route__title">Playlist</h1>
        <p className="route__note">No playlist id.</p>
      </section>
    );
  }

  const header = result.data?.pages[0];
  const headerThumb = header ? loopbackImage(header.thumbnailUrl) : null;
  const items = result.data?.pages.flatMap((p) => p.items) ?? [];

  let content: ReactNode;
  if (result.status === 'pending') {
    content = (
      <div className="playlist__loading" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <div className="playlist-row" key={i}>
            <span className="playlist-row__index" />
            <Skeleton width={140} height={78} radius="var(--radius-sm)" />
            <div className="playlist-row__text" style={{ display: 'grid', gap: 6 }}>
              <Skeleton height={13} />
              <Skeleton width="45%" height={11} />
            </div>
          </div>
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
    content = <EmptyState title="No videos in this playlist" />;
  } else {
    content = (
      <>
        <VirtualList
          items={items}
          renderItem={(video, index) => <PlaylistRow index={index} video={video} />}
          estimateItemHeight={ROW_ESTIMATE}
          gap={4}
          ariaLabel={`Videos in ${header?.title || 'this playlist'}`}
        />
        <div className="playlist__more">
          {result.status === 'error' ? (
            isStaleContinuation(result.error) ? (
              <ErrorState
                message="This playlist refreshed."
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
              <div ref={sentinelRef} className="playlist__sentinel" aria-hidden="true" />
            </>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <section className="playlist">
      {header && (
        <header className="playlist-head glass-panel">
          <div className="playlist-head__thumb">
            {headerThumb && <img src={headerThumb} alt="" loading="lazy" decoding="async" />}
          </div>
          <div className="playlist-head__text">
            <p className="route__kicker">Playlist</p>
            <h1 className="playlist-head__title display">{header.title || 'Untitled playlist'}</h1>
            <p className="playlist-head__meta tnum">
              {header.author && (
                <Link
                  className="playlist-head__author"
                  to={`/channel/${encodeURIComponent(header.author.id)}`}
                >
                  {header.author.name || 'Unknown channel'}
                </Link>
              )}
              {header.videoCount !== null && (
                <>
                  {header.author && <span aria-hidden="true">·</span>}
                  <span>{formatCompactCount(header.videoCount)} videos</span>
                </>
              )}
              {header.lastUpdatedText && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{header.lastUpdatedText}</span>
                </>
              )}
            </p>
          </div>
        </header>
      )}
      {content}
    </section>
  );
}
