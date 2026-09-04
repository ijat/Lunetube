/**
 * `Comments` / `CommentThread` / `CommentsContinuation` → the `@lunetube/shared`
 * comment DTOs. Pure — no I/O, no `youtubei.js` import, no throwing (same
 * defensive contract as the rest of `map/**`).
 *
 * **The one rule this file exists to enforce (plan P2-F6 #1).**
 * `CommentThread.has_continuation` is a getter that *throws* an `InnertubeError`
 * whenever `this.replies` has not been loaded
 * (youtubei.js@18.0.0 `classes/comments/CommentThread.js:31-35`). Nothing in this
 * file ever reads it. At map time the only reply-related things read off a thread
 * are the three that are always safe:
 *
 *  - `has_replies` — a plain boolean field assigned in the constructor
 *    (`CommentThread.js:26`, `!!this.comment_replies_data`);
 *  - `is_prepopulated` — a getter over `comment_replies_data` only
 *    (`CommentThread.js:39-41`), read through `safeFlag` because it dereferences
 *    `sub_threads[0]`;
 *  - `replies` — plain field, `undefined` until loaded, read through `safeArray`.
 *
 * Whether a thread has *more* reply pages is a question that can only be asked
 * after `getReplies()` has run, so it is asked in `source.ts`, on the
 * `replies-first:` branch, and nowhere else.
 *
 * **Handles.** `mintRepliesHandle` is injected rather than imported so this file
 * stays pure and store-free (the same dependency-injection shape as
 * `ImageRewriter`). `source.ts` passes `(t) => store.put('replies-first', t)`;
 * `FakeYouTubeSource` passes a fixture-stem minter. Both produce the same
 * `replies-first:…` handle grammar, so the renderer cannot tell them apart.
 *
 * **No HTML sink.** Comment text is extracted with `textToString` only. youtubei.js'
 * `Text.toHTML()` is never called here or anywhere downstream: the renderer has no
 * HTML sink at all (zero `dangerouslySetInnerHTML` in the repo — security ledger
 * S-P1), and uploader/commenter-controlled markup must never gain one.
 */
import type { ChannelRef, Comment, CommentThread } from '@lunetube/shared';
import { parseTimestampsFromText } from '@lunetube/shared';
import type { RawThumbnail } from './thumbnail.js';
import { nonEmpty, parseHumanCount, textToString, toIntOr, type MaybeText } from './util.js';
import { thumbUrl, type ImageRewriter } from './video.js';

// ---------------------------------------------------------------------------
// Structural shapes (mirroring the youtubei.js classes cited above)
// ---------------------------------------------------------------------------

/** `classes/misc/Author` — the subset a comment needs. */
interface RawCommentAuthor {
  id?: unknown;
  name?: unknown;
  thumbnails?: RawThumbnail[] | null;
  is_verified?: unknown;
  is_verified_artist?: unknown;
}

/** `classes/comments/CommentView` — every field optional but `comment_id`. */
export interface RawCommentView {
  comment_id?: unknown;
  author?: RawCommentAuthor | null;
  content?: MaybeText;
  /** A **string** like `"1.2K"`, not a number. */
  like_count?: unknown;
  published_time?: unknown;
  is_hearted?: unknown;
  is_pinned?: unknown;
  author_is_channel_owner?: unknown;
  /** A **string** like `"27"`, not a number. */
  reply_count?: unknown;
}

/**
 * `classes/comments/CommentThread`. Used for both top-level threads
 * (`Comments.contents`) and replies (`CommentThread.replies` /
 * `CommentsContinuation.replies` are `ObservedArray<CommentThread>`, not
 * `CommentView`s).
 *
 * `has_continuation` is deliberately **absent** from this interface: declaring it
 * would be an invitation to read the getter that throws.
 */
export interface RawCommentThreadNode {
  comment?: RawCommentView | null;
  rendering_priority?: unknown;
  has_replies?: unknown;
  is_prepopulated?: unknown;
  replies?: unknown;
}

/** `classes/comments/CommentsHeader` — `count` / `comments_count` are both `Text`. */
export interface RawCommentsHeader {
  count?: MaybeText;
  comments_count?: MaybeText;
}

/** Mints the opaque `replies-first:` handle for a thread that has replies. */
export type RepliesHandleMinter = (thread: unknown) => string | undefined;

const PINNED_PRIORITY = 'RENDERING_PRIORITY_PINNED_COMMENT';

// ---------------------------------------------------------------------------
// Guarded reads — a mapper must never let a throwing getter escape
// ---------------------------------------------------------------------------

/** `obj[key] === true`, treating a throwing getter as `false`. */
function safeFlag(obj: unknown, key: string): boolean {
  try {
    return (obj as Record<string, unknown> | null)?.[key] === true;
  } catch {
    return false;
  }
}

/** `obj[key]` as an array, treating a throwing getter or a non-array as `[]`. */
function safeArray(obj: unknown, key: string): unknown[] {
  try {
    const value = (obj as Record<string, unknown> | null)?.[key];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// CommentView → Comment
// ---------------------------------------------------------------------------

function mapAuthor(
  author: RawCommentAuthor | null | undefined,
  rewriteImage?: ImageRewriter,
): ChannelRef {
  return {
    id: typeof author?.id === 'string' ? author.id : '',
    name: nonEmpty(author?.name as MaybeText) ?? '',
    avatarUrl: thumbUrl(author?.thumbnails, rewriteImage, { maxWidth: 176 }),
  };
}

/**
 * One `CommentThread` node → the `Comment` DTO for its own comment.
 *
 * `renderingPriority` lives on the **thread**, `is_pinned` on the
 * **`CommentView`** — a pinned comment can be flagged through either, so both are
 * read. Returns `null` when the node carries no comment at all
 * (`CommentThread.comment` is `CommentView | null`) or when that comment has no
 * `comment_id`; such a node is skipped by the callers, never fatal.
 */
export function mapComment(
  node: RawCommentThreadNode | null | undefined,
  rewriteImage?: ImageRewriter,
): Comment | null {
  const view = node?.comment;
  if (view == null) return null;
  const id = typeof view.comment_id === 'string' ? view.comment_id.trim() : '';
  if (id.length === 0) return null;

  const text = textToString(view.content);

  return {
    id,
    author: mapAuthor(view.author, rewriteImage),
    authorIsUploader: view.author_is_channel_owner === true,
    authorIsVerified: view.author?.is_verified === true || view.author?.is_verified_artist === true,
    text,
    textTimestamps: parseTimestampsFromText(text),
    likeCount: parseHumanCount(view.like_count as MaybeText),
    publishedText: nonEmpty(view.published_time as MaybeText),
    isHearted: view.is_hearted === true,
    isPinned: view.is_pinned === true || node?.rendering_priority === PINNED_PRIORITY,
    replyCount: toIntOr(parseHumanCount(view.reply_count as MaybeText), 0),
  };
}

// ---------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------

/**
 * A list of reply nodes → flat `Comment[]`.
 *
 * Replies arrive as nested `CommentThread` nodes, so each one is flattened to the
 * single `Comment` its own `comment` carries. Exactly **one** level: YouTube has
 * no third comment level, and a reply's own `replies` is always absent.
 */
export function mapReplyComments(nodes: unknown, rewriteImage?: ImageRewriter): Comment[] {
  const out: Comment[] = [];
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const comment = mapComment(node as RawCommentThreadNode, rewriteImage);
    if (comment != null) out.push(comment);
  }
  return out;
}

/** The replies already attached to a node (`CommentThread.replies` / `CommentsContinuation.replies`). */
export function mapLoadedReplies(node: unknown, rewriteImage?: ImageRewriter): Comment[] {
  return mapReplyComments(safeArray(node, 'replies'), rewriteImage);
}

// ---------------------------------------------------------------------------
// CommentThread → the CommentThread DTO
// ---------------------------------------------------------------------------

/**
 * One `CommentThread` node → the DTO. `null` when the node has no usable comment
 * (a `comment: null` thread is skipped, not fatal).
 *
 * `replies` is populated from `has_replies` alone — see the file header for why
 * `has_continuation` cannot be consulted here. When the thread is
 * *prepopulated* the `Comments` constructor has already called
 * `processRepliesData()` for it (`Comments.js:30`), so reply page 1 is in
 * `thread.replies` and renders with **no** network call; otherwise `items` starts
 * empty and the `replies-first:` handle fetches page 1 on demand. The handle is
 * minted in both cases: it is also how the caller discovers whether a *second*
 * reply page exists.
 */
export function mapCommentThread(
  node: unknown,
  rewriteImage?: ImageRewriter,
  mintRepliesHandle?: RepliesHandleMinter,
): CommentThread | null {
  const thread = (node ?? {}) as RawCommentThreadNode;
  const comment = mapComment(thread, rewriteImage);
  if (comment == null) return null;

  if (!safeFlag(thread, 'has_replies')) return { comment, replies: null };

  const items = safeFlag(thread, 'is_prepopulated') ? mapLoadedReplies(thread, rewriteImage) : [];
  const handle = mintRepliesHandle?.(node);
  return {
    comment,
    replies:
      typeof handle === 'string' && handle.length > 0 ? { items, continuation: handle } : { items },
  };
}

/** `Comments.contents` → the DTO threads, skipping any node with no usable comment. */
export function mapCommentThreads(
  nodes: unknown,
  rewriteImage?: ImageRewriter,
  mintRepliesHandle?: RepliesHandleMinter,
): CommentThread[] {
  const out: CommentThread[] = [];
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const thread = mapCommentThread(node, rewriteImage, mintRepliesHandle);
    if (thread != null) out.push(thread);
  }
  return out;
}

/**
 * `CommentsHeader` → `CommentPage.header.totalText`. Both `count` and
 * `comments_count` are `Text` (`CommentsHeader.js:9-10`); which one is populated
 * varies by response, so `count` wins and `comments_count` is the fallback.
 */
export function mapCommentsTotalText(header: RawCommentsHeader | null | undefined): string | null {
  return nonEmpty(header?.count) ?? nonEmpty(header?.comments_count);
}
