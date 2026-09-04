import { Skeleton } from '@lunetube/design';
import './cards.css';

/**
 * The `VideoCard` silhouette while a page is in flight — same 16:9 thumb, same
 * 30px avatar, same two title lines, so the grid does not reflow when the real
 * cards arrive. Built from the shared `Skeleton` primitive so the shimmer (and
 * its `prefers-reduced-motion` collapse) stay in one place.
 */
export function CardSkeleton() {
  return (
    <div className="card-skeleton" aria-hidden="true">
      <Skeleton className="card-skeleton__thumb" height="auto" radius="var(--radius-card)" />
      <div className="card-skeleton__body">
        <Skeleton width={30} height={30} radius="50%" />
        <div className="card-skeleton__lines">
          <Skeleton height={13} />
          <Skeleton width="62%" height={13} />
          <Skeleton width="40%" height={9} />
        </div>
      </div>
    </div>
  );
}
