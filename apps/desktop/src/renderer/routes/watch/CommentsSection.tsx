import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ChevronDown, MessageSquare } from 'lucide-react';
import { Button, Segmented, type SegmentedOption } from '@lunetube/design';
import {
  formatCompactCount,
  type Comment,
  type CommentSort,
  type CommentThread,
} from '@lunetube/shared';
import { EmptyState } from '../../components/EmptyState.js';
import { ErrorState } from '../../components/ErrorState.js';
import { VirtualList } from '../../components/VirtualList.js';
import { useScrollContainer } from '../../shell/ScrollContainer.js';
import { isStaleContinuation, useCommentReplies, useComments } from '../../lib/queries.js';
import { CommentRow } from './CommentRow.js';
import { flattenComments, type CommentRowData, type ReplyState } from './flattenComments.js';
import './comments.css';

/**
 * Threaded comments (plan P2-10). The hard part is not the markup — it is that
 * threads expand **in place**, splicing reply rows into the middle of a
 * virtualized list that lives inside the app's one page-level scroller
 * (`.stage__content`, P2-F11).
 *
 * ## Invariants
 *
 * **I1 — one index space.** `flattenComments` produces the row array; `count`
 * and `getItemKey` are both read off *that* array in the same render, so the
 * virtualizer's index space cannot disagree with what is rendered. See
 * `flattenComments.ts` for I1–I4 in full.
 *
 * **I2 — `getItemKey` is comment-id-derived, never index-derived.**
 * `VirtualList` defaults to an index-based key extractor, and
 * `@tanstack/virtual-core` keys its measured-height cache by that key
 * (`dist/esm/index.js:638-639`). Splicing K reply rows into the middle with the
 * default extractor re-points every later row at the previous row's measurement
 * and the list visibly jumps. This is the one place in the app that *must*
 * supply `getItemKey`, and the P2-7 hand-off called it out as exactly this case.
 *
 * **I3 — one reply query per expanded thread, and hooks stay legal.**
 * `useCommentReplies` is a hook, so it cannot be called in a loop over a dynamic
 * list of threads. Each expanded thread therefore mounts one headless
 * `ReplyLoader` that owns its own infinite query and mirrors the result up
 * through `onState`. The mirror only fires when the memoized state object
 * actually changes identity (react-query keeps `data` referentially stable
 * between renders), so it cannot loop. Collapsing unmounts the loader, which
 * releases its slice of state and its controls entry.
 *
 * **I4 — sort is a different index space.** Switching Top ⇄ Newest changes the
 * query key (`ytKeys.comments(videoId, sort)`) and therefore the whole thread
 * set. An expansion map still holding the other sort's comment ids would splice
 * replies under the wrong thread or under none at all, so the sort handler
 * clears the expansion map, the reply-state map and the controls registry
 * together. The same reset is guaranteed across videos by keying this component
 * on `videoId` at the call site.
 *
 * **I5 — the clicked row keeps its place.** See `ANCHOR_COMMITS` below.
 *
 * **I6 — no HTML sink.** All comment text goes through `CommentText`, which
 * renders JSX children only. See its file header.
 *
 * ## I2, measured in a real Chromium
 *
 * jsdom has no layout, so none of this is testable there (`VirtualGrid.tsx`
 * says the same, at length). It was measured instead with a throwaway Playwright
 * harness and a generated 120-thread fixture — built, run, reverted, never
 * committed — walking the whole list first so every row held a *real*
 * measurement, then returning to the top and expanding a thread:
 *
 * | | total list height before → after | expected delta |
 * |---|---|---|
 * | with `getItemKey` (shipped) | 15422 → **15626** px | +204 = 2×82 replies + 40 control row — **exact** |
 * | index keys (`getItemKey` removed) | 15422 → **15614** px | 12 px short, and it only converged back to 15626 after the mis-keyed rows were re-mounted and re-measured |
 *
 * That 12 px is the whole bug in miniature: it is the layout error over rows
 * that are measured but not mounted, so nothing re-measures them when their key
 * shifts, and it scales with the number of rows spliced in (a 20-reply thread
 * shifts 20 keys, not 3). The same run also confirmed windowing is real (8 of
 * 124 rows mounted), rows never overlap (max 0.25 px, sub-pixel), the document
 * still has exactly one scroller, `scrollTop` does not drift across a splice,
 * and expanding the prepopulated fixture thread yields **one** reply rather than
 * two — the inline-vs-fetched dedupe (I3) working end to end.
 */

const SORT_OPTIONS: SegmentedOption<CommentSort>[] = [
  { value: 'top', label: 'Top' },
  { value: 'newest', label: 'Newest' },
];

/** Mixed comment / reply / control rows — an average, not a target. */
const ESTIMATE_ROW_HEIGHT = 104;

/**
 * How many commits the post-splice scroll anchor stays armed for (I5).
 *
 * With a stable `getItemKey` the splice itself does not move the clicked row:
 * rows are laid out from the top, so inserting replies *after* the toggle row
 * changes only the offsets of rows below it. The anchor covers what is left
 * over — the browser clamping `scrollTop` when a collapse shrinks the document
 * under a viewport that was near the bottom, and the extra commits react-virtual
 * emits as the freshly mounted reply rows are measured and the total size
 * settles. Those all land within a few frames of the click, which is why the
 * budget is a small fixed number of commits rather than a condition that could
 * keep the anchor armed across a slow reply fetch and then yank the user back
 * after they had scrolled somewhere else.
 *
 * In the Chromium harness above the correction was a no-op on every expand and
 * every collapse (`delta === 0`, `scrollTop` unchanged at 959) — which is the
 * predicted result, not a sign the code is dead: it is the residual cases it is
 * there for, and a no-op that costs one `getBoundingClientRect` on four commits
 * is the right price for them.
 */
const ANCHOR_COMMITS = 4;

const EMPTY_EXPANDED: ReadonlySet<string> = new Set();
const EMPTY_REPLY_STATES: Readonly<Record<string, ReplyState>> = {};
const EMPTY_REPLIES: readonly Comment[] = [];

interface ReplyControls {
  loadMore: () => void;
  retry: () => void;
}

// ---------------------------------------------------------------------------
// ReplyLoader — one per expanded thread (I3)
// ---------------------------------------------------------------------------

interface ReplyLoaderProps {
  threadKey: string;
  /** The thread's opaque `replies-first:` handle (A17). */
  handle: string;
  onState: (threadKey: string, state: ReplyState) => void;
  onRelease: (threadKey: string) => void;
  registry: Map<string, ReplyControls>;
}

/**
 * Renders nothing. It exists so that `useCommentReplies` — a hook, and therefore
 * un-loopable — can be instantiated once per expanded thread while the *rows*
 * stay in one flat array owned by `CommentsSection`.
 */
function ReplyLoader({ threadKey, handle, onState, onRelease, registry }: ReplyLoaderProps) {
  const query = useCommentReplies(handle, true);
  const { data, error, isFetching, hasNextPage, fetchNextPage, refetch } = query;

  const items = useMemo(() => data?.pages.flatMap((page) => page.items) ?? EMPTY_REPLIES, [data]);

  const message =
    error === null
      ? null
      : isStaleContinuation(error)
        ? 'This thread refreshed. Reload to see its replies.'
        : error.message;

  const state = useMemo<ReplyState>(
    () => ({ items, hasMore: hasNextPage, loading: isFetching, error: message }),
    [items, hasNextPage, isFetching, message],
  );

  // Fires only when `state`'s identity changes, and `state` only changes when
  // one of its four inputs really did — react-query keeps `data` referentially
  // stable between renders (I3).
  useEffect(() => {
    onState(threadKey, state);
  }, [onState, threadKey, state]);

  // Imperative controls live in a ref-held Map rather than in the mirrored
  // state: a "Show more replies" click does not need to be reactive, and putting
  // two function identities into render state would churn it on every fetch.
  useEffect(() => {
    registry.set(threadKey, {
      loadMore: () => void fetchNextPage(),
      retry: () => void refetch(),
    });
    return () => {
      registry.delete(threadKey);
    };
  }, [registry, threadKey, fetchNextPage, refetch]);

  // Unmount-only: a cleanup on the state effect above would fire on every
  // change, not just on collapse.
  useEffect(() => () => onRelease(threadKey), [onRelease, threadKey]);

  return null;
}

// ---------------------------------------------------------------------------
// CommentsSection
// ---------------------------------------------------------------------------

/** The toggle row's element for `threadKey`, or `null` if it is not mounted. */
function findAnchor(root: HTMLElement, threadKey: string): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>('[data-thread-anchor]')) {
    if (el.dataset['threadAnchor'] === threadKey) return el;
  }
  return null;
}

function replyLabel(count: number): string {
  if (count <= 0) return 'View replies';
  return `View ${formatCompactCount(count)} ${count === 1 ? 'reply' : 'replies'}`;
}

export interface CommentsSectionProps {
  videoId: string;
  /** The video's channel name — "Pinned by …" / "Hearted by …". */
  uploaderName: string;
  /** The watch page's `handleSeek` (P1-6 / F6). */
  onSeek: (seconds: number) => void;
}

export function CommentsSection({ videoId, uploaderName, onSeek }: CommentsSectionProps) {
  const [sort, setSort] = useState<CommentSort>('top');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(EMPTY_EXPANDED);
  const [replyStates, setReplyStates] =
    useState<Readonly<Record<string, ReplyState>>>(EMPTY_REPLY_STATES);

  const controls = useRef(new Map<string, ReplyControls>());
  const rootRef = useRef<HTMLElement | null>(null);
  const anchorRef = useRef<{ key: string; top: number; budget: number } | null>(null);
  const getScrollElement = useScrollContainer();

  const query = useComments(videoId, sort);
  const { data, status, error, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  const threads = useMemo<CommentThread[]>(
    () => data?.pages.flatMap((page) => page.threads) ?? [],
    [data],
  );

  const totalText = data?.pages[0]?.header.totalText ?? null;

  /** thread key → its opaque reply handle. Threads with no handle cannot page. */
  const handles = useMemo(() => {
    const map = new Map<string, string>();
    for (const thread of threads) {
      const handle = thread.replies?.continuation;
      if (handle !== undefined && handle.length > 0 && !map.has(thread.comment.id)) {
        map.set(thread.comment.id, handle);
      }
    }
    return map;
  }, [threads]);

  const rows = useMemo(
    () =>
      flattenComments(threads, expanded, replyStates, {
        // On a failed next-page fetch the inline error below the list is the
        // affordance; a "Load more" button that just failed is not.
        hasMoreComments: hasNextPage && status !== 'error',
      }),
    [threads, expanded, replyStates, hasNextPage, status],
  );

  // I1/I2: same array, same render.
  const getItemKey = useCallback((index: number) => rows[index]?.key ?? index, [rows]);

  const handleReplyState = useCallback((threadKey: string, state: ReplyState) => {
    setReplyStates((prev) => (prev[threadKey] === state ? prev : { ...prev, [threadKey]: state }));
  }, []);

  const releaseReplyState = useCallback((threadKey: string) => {
    setReplyStates((prev) => {
      if (!(threadKey in prev)) return prev;
      const next = { ...prev };
      delete next[threadKey];
      return next;
    });
  }, []);

  const toggleThread = useCallback((threadKey: string, element: HTMLElement) => {
    // I5: captured *before* the state change, so the restore target is the
    // clicked row's position at click time.
    anchorRef.current = {
      key: threadKey,
      top: element.getBoundingClientRect().top,
      budget: ANCHOR_COMMITS,
    };
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(threadKey)) next.add(threadKey);
      return next;
    });
  }, []);

  const changeSort = useCallback(
    (next: CommentSort) => {
      if (next === sort) return;
      // I4 — all three together, or a stale expansion map outlives its threads.
      setSort(next);
      setExpanded(EMPTY_EXPANDED);
      setReplyStates(EMPTY_REPLY_STATES);
      controls.current.clear();
      anchorRef.current = null;
    },
    [sort],
  );

  // I5. Runs on every commit while the anchor is armed — including the commits
  // react-virtual drives as it measures the newly mounted rows.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (anchor === null) return;
    const root = rootRef.current;
    const scroller = getScrollElement();
    const el = root === null ? null : findAnchor(root, anchor.key);
    if (el === null || scroller === null) {
      // Scrolled out of the virtual window (or no scroller yet): there is
      // nothing to hold in place any more.
      anchorRef.current = null;
      return;
    }
    const delta = el.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) >= 1) scroller.scrollTop += delta;
    anchor.budget -= 1;
    if (anchor.budget <= 0) anchorRef.current = null;
  });

  const renderRow = useCallback(
    (row: CommentRowData): ReactNode => {
      switch (row.kind) {
        case 'comment':
        case 'reply':
          return (
            <CommentRow
              comment={row.comment}
              depth={row.depth}
              uploaderName={uploaderName}
              onSeek={onSeek}
            />
          );

        // Control rows sit in a `.comment__ctl` wrapper because a virtualized
        // row's gutter must be *padding* — a margin on the row's own content
        // lives outside the border box `measureElement` reads, so every row
        // would overlap the next by exactly the margin.
        case 'show-replies':
          return (
            <div className="comment__ctl">
              <button
                type="button"
                className="comment__toggle"
                data-thread-anchor={row.threadKey}
                aria-expanded={row.expanded}
                onClick={(event) => toggleThread(row.threadKey, event.currentTarget)}
              >
                <ChevronDown
                  className="comment__chev"
                  data-expanded={row.expanded}
                  size={15}
                  strokeWidth={2}
                  aria-hidden="true"
                />
                {row.expanded ? 'Hide replies' : replyLabel(row.count)}
              </button>
            </div>
          );

        case 'more-replies':
          return (
            <div className="comment__ctl comment__ctl--reply">
              {row.error !== null ? (
                <p className="comment__reply-note comment__reply-note--error" role="alert">
                  {row.error}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => controls.current.get(row.threadKey)?.retry()}
                  >
                    Try again
                  </Button>
                </p>
              ) : row.loading ? (
                <p className="comment__reply-note">Loading replies…</p>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => controls.current.get(row.threadKey)?.loadMore()}
                >
                  Show more replies
                </Button>
              )}
            </div>
          );

        case 'load-more':
          return (
            <div className="comments__more">
              <Button
                variant="surface"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? 'Loading…' : 'Load more comments'}
              </Button>
            </div>
          );
      }
    },
    [uploaderName, onSeek, toggleThread, fetchNextPage, isFetchingNextPage],
  );

  let content: ReactNode;
  if (status === 'pending') {
    content = <p className="watch__section-note">Loading comments…</p>;
  } else if (status === 'error' && data === undefined && error !== null) {
    content = isStaleContinuation(error) ? (
      <ErrorState
        message="These comments refreshed."
        hint="Reload to keep reading."
        onRetry={() => void refetch()}
      />
    ) : (
      <ErrorState
        message={error.message}
        {...(error.hint ? { hint: error.hint } : {})}
        {...(error.retryable ? { onRetry: () => void refetch() } : {})}
      />
    );
  } else if (threads.length === 0) {
    content = (
      <EmptyState
        title="No comments yet"
        hint="Comments may be turned off for this video."
        icon={<MessageSquare size={22} strokeWidth={1.6} aria-hidden="true" />}
      />
    );
  } else {
    content = (
      <>
        <VirtualList
          items={rows}
          renderItem={renderRow}
          getItemKey={getItemKey}
          estimateItemHeight={ESTIMATE_ROW_HEIGHT}
          ariaLabel="Comments"
        />
        {status === 'error' && error !== null && (
          <div className="comments__more">
            {isStaleContinuation(error) ? (
              <ErrorState
                message="These comments refreshed."
                hint="Reload to keep reading."
                onRetry={() => void refetch()}
              />
            ) : (
              <ErrorState
                message={error.message}
                {...(error.hint ? { hint: error.hint } : {})}
                {...(error.retryable ? { onRetry: () => void fetchNextPage() } : {})}
              />
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <section className="comments" aria-labelledby="comments-title" ref={rootRef}>
      <header className="comments__head">
        <h2 id="comments-title" className="watch__section-title">
          <MessageSquare size={16} strokeWidth={1.8} aria-hidden="true" />
          Comments
          {totalText !== null && <span className="comments__total tnum">{totalText}</span>}
        </h2>
        <Segmented
          options={SORT_OPTIONS}
          value={sort}
          onChange={changeSort}
          ariaLabel="Sort comments"
        />
      </header>

      {/* Headless: one infinite query per expanded thread (I3). */}
      {[...expanded].map((threadKey) => {
        const handle = handles.get(threadKey);
        return handle === undefined ? null : (
          <ReplyLoader
            key={threadKey}
            threadKey={threadKey}
            handle={handle}
            onState={handleReplyState}
            onRelease={releaseReplyState}
            registry={controls.current}
          />
        );
      })}

      {content}
    </section>
  );
}
