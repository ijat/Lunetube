import { useCallback, useRef } from 'react';

/**
 * Shared infinite-scroll sentinel for the paged grid/list routes — `search`,
 * `channel` and `playlist` (before this it was three byte-identical callback
 * refs). Returns a ref callback to spread onto a 1px sentinel `<div>` rendered
 * just below the manual "Load more" button.
 *
 * **Why it ignores the observer's initial notification.** The sentinel and the
 * "Load more" button are siblings inside `.{route}__more`. When page 1 does not
 * fill the viewport the sentinel is already on screen at mount, so acting on
 * `IntersectionObserver`'s first (initial-state) callback auto-pages the list
 * with no user intent — the button flips to its disabled "Loading…" state and
 * then unmounts underneath whoever, a user or a Playwright click, was
 * interacting with it (code-review F10; the check-then-act detach was flaking
 * the e2e sweep). Only a *transition* into view — the user actually scrolled the
 * sentinel into range — triggers a load. On a full page 1 the sentinel starts
 * below the fold, so nothing is lost.
 *
 * `onLoadMore` is read through a ref so a fresh closure each render does not
 * tear down and rebuild the observer.
 */
export function useInfiniteScrollSentinel(
  onLoadMore: () => void,
): (el: HTMLDivElement | null) => (() => void) | undefined {
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  return useCallback((el: HTMLDivElement | null) => {
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    let sawInitial = false;
    const observer = new IntersectionObserver((entries) => {
      if (!sawInitial) {
        sawInitial = true;
        return;
      }
      if (entries.some((entry) => entry.isIntersecting)) onLoadMoreRef.current();
    });
    observer.observe(el);
    // React 19 ref-callback cleanup — runs on unmount/detach.
    return () => observer.disconnect();
  }, []);
}
