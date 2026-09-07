/**
 * The comment list's **index space** (plan P2-10).
 *
 * `CommentsSection` renders a single flat array of rows through `VirtualList`,
 * and threads expand by *splicing reply rows into the middle of that array*.
 * That is the whole correctness problem of this step, so the splice itself is a
 * pure function with no React in it and no I/O — everything that can go wrong
 * here can be asserted in a unit test.
 *
 * ## Invariants
 *
 * **I1 — one array, one index space.** The row array returned here is the only
 * thing `VirtualList` is given: `count = rows.length` and
 * `getItemKey(i) = rows[i].key` both derive from the *same* array in the *same*
 * render, so the virtualizer's index space can never disagree with what is
 * rendered at that index.
 *
 * **I2 — keys are derived from comment ids, never from an index.**
 * `@tanstack/virtual-core@3.17.8` keys its measured-height cache by
 * `getItemKey(index)` (`dist/esm/index.js:638-639` reads it, `:893` writes it),
 * *not* by index. So inserting K reply rows after row `i` leaves the cached
 * height of every row after the insertion point addressable under its own
 * unchanged key. With the default index-based key extractor the same splice
 * would re-point every subsequent row at the *previous* row's measurement, and
 * the list visibly jumps. Every key here is `<kind>:<comment id>` (replies also
 * namespaced by their thread), so no key changes when another thread expands.
 *
 * **I3 — keys are unique.** Two rows sharing a key would share a measurement
 * (and collide as React siblings). YouTube's comment pagination can repeat a
 * thread across pages, so a thread whose id has already been emitted is
 * dropped, and replies are deduped by id within their thread. The dedupe is
 * also what makes a *prepopulated* thread correct: `mapCommentThread`
 * (`packages/youtube/src/innertube/map/comments.ts`) puts reply page 1 inline in
 * `thread.replies.items` **and** hands out a `replies-first:` handle that
 * re-fetches that same page 1, so the inline items and the first fetched page
 * genuinely overlap by construction.
 *
 * **I4 — the toggle row exists in both states.** `show-replies` is emitted for
 * every thread that has replies, expanded or not, so its key (and therefore its
 * measured height) survives its own click. It renders as "View N replies" or
 * "Hide replies" from its `expanded` flag.
 *
 * ## Complexity
 *
 * O(T + ΣR) time and O(rows) space for T threads with R merged replies each —
 * one pass, one `Set` per thread for the reply dedupe plus one for thread ids.
 * Real scale: a comment page is ~20 threads, `useComments` accumulates pages, and
 * a thread's expanded replies are bounded by what the user has actually paged in.
 * There is no nested scan and nothing quadratic.
 */
import type { Comment, CommentThread } from '@lunetube/shared';

export type CommentRowData =
  | { kind: 'comment'; key: string; comment: Comment; depth: 0; threadKey: string }
  | { kind: 'reply'; key: string; comment: Comment; depth: 1; threadKey: string }
  | { kind: 'show-replies'; key: string; threadKey: string; count: number; expanded: boolean }
  | { kind: 'more-replies'; key: string; threadKey: string; loading: boolean; error: string | null }
  | { kind: 'load-more'; key: string };

/**
 * What `CommentsSection` knows about one expanded thread's replies. Mirrors the
 * `useCommentReplies` infinite query for that thread's handle; absent while the
 * thread is collapsed (nothing is fetched until it is expanded).
 */
export interface ReplyState {
  /** Replies fetched so far, in page order. */
  items: readonly Comment[];
  /** A further reply page exists (`hasNextPage`). */
  hasMore: boolean;
  /** A reply fetch is in flight (initial page or next page). */
  loading: boolean;
  /** User-facing failure text for this thread's replies, else `null`. */
  error: string | null;
}

export interface FlattenOptions {
  /** Emit the trailing "load more comments" row. */
  hasMoreComments?: boolean;
}

const NO_REPLIES: readonly Comment[] = [];

/**
 * Inline (prepopulated) replies followed by every fetched page, deduped by id
 * with first occurrence winning — see I3 for why the overlap is guaranteed
 * rather than hypothetical.
 */
function mergeReplies(
  inline: readonly Comment[],
  fetched: readonly Comment[] | undefined,
): readonly Comment[] {
  if (inline.length === 0 && (fetched === undefined || fetched.length === 0)) return NO_REPLIES;
  const seen = new Set<string>();
  const out: Comment[] = [];
  for (const source of fetched === undefined ? [inline] : [inline, fetched]) {
    for (const reply of source) {
      if (reply.id.length === 0 || seen.has(reply.id)) continue;
      seen.add(reply.id);
      out.push(reply);
    }
  }
  return out;
}

/**
 * `(threads, expanded, replyPages) → rows`. Pure: same inputs, same output, no
 * dependence on anything outside its arguments.
 *
 * @param threads    every loaded `CommentPage`'s threads, concatenated in page order.
 * @param expanded   thread keys (= top-level comment ids) the user has opened.
 * @param replyPages per-thread reply state, keyed by thread key.
 */
export function flattenComments(
  threads: readonly CommentThread[],
  expanded: ReadonlySet<string>,
  replyPages: Readonly<Record<string, ReplyState | undefined>>,
  options: FlattenOptions = {},
): CommentRowData[] {
  const rows: CommentRowData[] = [];
  const seenThreads = new Set<string>();

  for (const thread of threads) {
    const threadKey = thread.comment.id;
    // I3: a comment with no id cannot produce a stable key, and a repeated
    // thread would produce a duplicate one.
    if (threadKey.length === 0 || seenThreads.has(threadKey)) continue;
    seenThreads.add(threadKey);

    rows.push({
      kind: 'comment',
      key: `c:${threadKey}`,
      comment: thread.comment,
      depth: 0,
      threadKey,
    });

    const { replies } = thread;
    if (replies === null) continue;

    const state = replyPages[threadKey];
    const isExpanded = expanded.has(threadKey);
    const merged = isExpanded ? mergeReplies(replies.items, state?.items) : NO_REPLIES;

    // I4: emitted in both states. The count is the largest honest number we
    // have — `replyCount` is upstream's own total, which can lag what is
    // actually loaded (and is 0 on a thread whose count failed to parse).
    rows.push({
      kind: 'show-replies',
      key: `t:${threadKey}`,
      threadKey,
      count: Math.max(thread.comment.replyCount, replies.items.length, merged.length),
      expanded: isExpanded,
    });

    if (!isExpanded) continue;

    for (const reply of merged) {
      rows.push({
        kind: 'reply',
        key: `r:${threadKey}:${reply.id}`,
        comment: reply,
        depth: 1,
        threadKey,
      });
    }

    const loading = state?.loading ?? false;
    const error = state?.error ?? null;
    if ((state?.hasMore ?? false) || loading || error !== null) {
      rows.push({ kind: 'more-replies', key: `m:${threadKey}`, threadKey, loading, error });
    }
  }

  // A single fixed key: there is at most one of these and it is always last.
  if (options.hasMoreComments === true) rows.push({ kind: 'load-more', key: 'load-more' });

  return rows;
}
