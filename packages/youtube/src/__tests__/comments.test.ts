import { describe, expect, it, vi } from 'vitest';
import {
  mapComment,
  mapCommentThread,
  mapCommentThreads,
  mapCommentsTotalText,
  mapReplyComments,
} from '../innertube/map/comments.js';
import { InnertubeYouTubeSource, type InnertubeYouTubeSourceOptions } from '../innertube/source.js';
import { FakeYouTubeSource } from '../fake/FakeYouTubeSource.js';
import { identityRewriter } from '../contract.js';

const REWRITERS = { media: identityRewriter };

function sourceWith(yt: Record<string, unknown>): InnertubeYouTubeSource {
  return new InnertubeYouTubeSource({
    cacheDir: '',
    rewriters: REWRITERS,
    createInnertube: (() =>
      Promise.resolve(yt)) as unknown as InnertubeYouTubeSourceOptions['createInnertube'],
  });
}

const VIDEO_ID = 'dQw4w9WgXcQ';

// ---------------------------------------------------------------------------
// Stand-ins for the three youtubei.js classes this step drives.
//
// They are faithful in exactly the ways the reply state machine turns on, all
// verified in youtubei.js@18.0.0 before being modelled here:
//
//  - `CommentThread.has_continuation` THROWS while `replies` is unset
//    (`classes/comments/CommentThread.js:31-35`). `FakeThread` throws too, and
//    counts every read, so a mapper that asks the question too early is caught
//    by the counter even if something swallowed the throw.
//  - `CommentThread.getReplies()` returns `this` (`:65`); it performs no request
//    at all when `is_prepopulated` (`:50`), and otherwise reassigns
//    `this.replies = observe([])` from scratch on every call (`:100`), which is
//    what makes a replay return the same page 1 rather than advancing.
//  - `CommentThread.getContinuation()` returns a NEW `CommentsContinuation` and
//    does not mutate `this` (`:70-82`); `CommentsContinuation.getContinuation()`
//    likewise (`classes/misc/CommentsContinuation.js:38-46`), and its own
//    `has_continuation` never throws (`:32-34`).
//  - `Comments.getContinuation()` returns a NEW `Comments`, copying the page so
//    the header survives (`youtube/Comments.js:73-85`).
// ---------------------------------------------------------------------------

interface RawNode {
  type: string;
  comment: Record<string, unknown> | null;
}

function replyNode(id: string, overrides: Record<string, unknown> = {}): RawNode {
  return {
    type: 'CommentThread',
    comment: { comment_id: id, content: { text: `reply ${id}` }, ...overrides },
  };
}

class FakeContinuation {
  readonly replies: RawNode[];
  readonly #rest: string[][];

  constructor(page: string[], rest: string[][]) {
    this.replies = page.map((id) => replyNode(id));
    this.#rest = rest;
  }

  get has_continuation(): boolean {
    return this.#rest.length > 0;
  }

  async getContinuation(): Promise<FakeContinuation> {
    const [next, ...rest] = this.#rest;
    if (next === undefined) throw new Error('No continuation item found');
    return new FakeContinuation(next, rest);
  }
}

interface FakeThreadInit {
  id: string;
  hasReplies?: boolean;
  prepopulated?: boolean;
  renderingPriority?: string;
  comment?: Record<string, unknown> | null;
  /** Replies the `Comments` constructor already attached (prepopulated case). */
  inline?: string[];
  /** Reply page 1, fetched by `getReplies()` (not-prepopulated case). */
  page1?: string[];
  /** Further reply pages reachable through `getContinuation()`, in order. */
  morePages?: string[][];
  /** Model `getReplies()` returning without assigning `replies` (`:61-63`). */
  leaveRepliesUnset?: boolean;
}

class FakeThread {
  readonly comment: Record<string, unknown> | null;
  readonly has_replies: boolean;
  readonly is_prepopulated: boolean;
  readonly rendering_priority: string | undefined;
  replies: RawNode[] | undefined;

  /** Reads of the throwing getter. The tripwire for "never asked too early". */
  hasContinuationReads = 0;
  getRepliesCalls = 0;
  /** Requests `getReplies()` would put on the wire. Zero when prepopulated. */
  networkCalls = 0;

  readonly #init: FakeThreadInit;

  constructor(init: FakeThreadInit) {
    this.#init = init;
    this.comment =
      init.comment !== undefined
        ? init.comment
        : { comment_id: init.id, content: { text: `comment ${init.id}` } };
    this.has_replies = init.hasReplies ?? false;
    this.is_prepopulated = init.prepopulated ?? false;
    this.rendering_priority = init.renderingPriority;
    // `Comments`' constructor calls `processRepliesData()` on every thread
    // (`Comments.js:30`), which attaches the replies of a prepopulated thread.
    if (this.is_prepopulated) this.replies = (init.inline ?? []).map((id) => replyNode(id));
  }

  get has_continuation(): boolean {
    this.hasContinuationReads += 1;
    if (this.replies === undefined) {
      throw new Error(
        "Cannot determine if there is a continuation because this comment thread's replies have not been loaded",
      );
    }
    return (this.#init.morePages ?? []).length > 0;
  }

  async getReplies(): Promise<this> {
    this.getRepliesCalls += 1;
    if (!this.is_prepopulated) {
      this.networkCalls += 1;
      if (this.#init.leaveRepliesUnset !== true) {
        this.replies = (this.#init.page1 ?? []).map((id) => replyNode(id));
      }
    }
    return this;
  }

  async getContinuation(): Promise<FakeContinuation> {
    if (this.replies === undefined) throw new Error('replies have not been loaded');
    const [next, ...rest] = this.#init.morePages ?? [];
    if (next === undefined) throw new Error('No continuation item found');
    return new FakeContinuation(next, rest);
  }
}

class FakeComments {
  readonly header = { count: { text: '12,483 Comments' }, comments_count: { text: '12K' } };
  readonly contents: FakeThread[];
  readonly #more: FakeThreadInit[][];
  getContinuationCalls = 0;

  constructor(threads: FakeThreadInit[], more: FakeThreadInit[][] = []) {
    this.contents = threads.map((init) => new FakeThread(init));
    this.#more = more;
  }

  get has_continuation(): boolean {
    return this.#more.length > 0;
  }

  async getContinuation(): Promise<FakeComments> {
    this.getContinuationCalls += 1;
    const [next, ...rest] = this.#more;
    if (next === undefined) throw new Error('No continuation item found');
    return new FakeComments(next, rest);
  }
}

// ---------------------------------------------------------------------------
// map/comments.ts — pure mapping
// ---------------------------------------------------------------------------

describe('mapComment', () => {
  it('maps a fully-populated CommentView', () => {
    const node = {
      rendering_priority: 'RENDERING_PRIORITY_UNKNOWN',
      comment: {
        comment_id: 'UgxAbc123',
        author: {
          id: 'UC1111111111111111111111',
          name: 'Someone',
          thumbnails: [{ url: 'https://yt3.ggpht.com/a.jpg', width: 176, height: 176 }],
          is_verified: true,
        },
        content: { text: 'Great video, the part at 1:02:30 especially.' },
        like_count: '1.2K',
        published_time: '3 months ago',
        is_hearted: true,
        is_pinned: true,
        author_is_channel_owner: true,
        reply_count: '27',
      },
    };
    expect(mapComment(node)).toEqual({
      id: 'UgxAbc123',
      author: {
        id: 'UC1111111111111111111111',
        name: 'Someone',
        avatarUrl: 'https://yt3.ggpht.com/a.jpg',
      },
      authorIsUploader: true,
      authorIsVerified: true,
      text: 'Great video, the part at 1:02:30 especially.',
      textTimestamps: [{ index: 25, length: 7, seconds: 3750 }],
      likeCount: 1200,
      publishedText: '3 months ago',
      isHearted: true,
      isPinned: true,
      replyCount: 27,
    });
  });

  it('reads isPinned from the thread-level rendering_priority too', () => {
    const node = {
      rendering_priority: 'RENDERING_PRIORITY_PINNED_COMMENT',
      comment: { comment_id: 'UgxPinned' },
    };
    expect(mapComment(node)?.isPinned).toBe(true);
  });

  it('treats a verified *artist* as verified', () => {
    const node = { comment: { comment_id: 'UgxArtist', author: { is_verified_artist: true } } };
    expect(mapComment(node)?.authorIsVerified).toBe(true);
  });

  it('degrades to a partial Comment when every optional field is absent', () => {
    expect(mapComment({ comment: { comment_id: 'UgxBare' } })).toEqual({
      id: 'UgxBare',
      author: { id: '', name: '', avatarUrl: null },
      authorIsUploader: false,
      authorIsVerified: false,
      text: '',
      textTimestamps: [],
      likeCount: null,
      publishedText: null,
      isHearted: false,
      isPinned: false,
      replyCount: 0,
    });
  });

  it('returns null for a thread whose comment is null, or which has no comment_id', () => {
    expect(mapComment({ comment: null })).toBeNull();
    expect(mapComment({ comment: {} })).toBeNull();
    expect(mapComment({ comment: { comment_id: '   ' } })).toBeNull();
    expect(mapComment(null)).toBeNull();
  });

  it('extracts PLAIN TEXT only — never HTML, even when the node offers it', () => {
    // youtubei.js' `Text` also exposes `toHTML()`. The renderer has no HTML sink
    // and this adapter must not create the pressure for one, so the mapper only
    // ever walks `text` / `runs`. A node that would happily hand over markup is
    // the non-vacuous way to assert that.
    const toHTML = vi.fn(() => '<b onclick="steal()">bold</b>');
    const thread = mapCommentThread({
      comment: {
        comment_id: 'UgxHtml',
        content: { runs: [{ text: '<b>bold</b>' }, { text: ' & plain' }], toHTML },
      },
    });
    expect(thread?.comment.text).toBe('<b>bold</b> & plain');
    expect(toHTML).not.toHaveBeenCalled();
  });
});

describe('mapCommentThread', () => {
  const mint = (): string => 'replies-first:handle';

  it('never reads has_continuation — the getter that throws (P2-F6 #1)', () => {
    let reads = 0;
    const node = {
      has_replies: true,
      is_prepopulated: true,
      replies: [replyNode('r1')],
      comment: { comment_id: 'UgxGuard' },
      get has_continuation(): boolean {
        reads += 1;
        throw new Error('replies have not been loaded');
      },
    };
    expect(() => mapCommentThread(node, undefined, mint)).not.toThrow();
    // If the guard were removed and the mapper consulted `has_continuation`,
    // this counter would be non-zero — the assertion that actually fails, and
    // the one that survives even if the throw is swallowed somewhere.
    expect(reads).toBe(0);
  });

  it('leaves replies null and mints no handle when the thread has none', () => {
    const minter = vi.fn(mint);
    const thread = mapCommentThread(
      { has_replies: false, comment: { comment_id: 'UgxNoReplies' } },
      undefined,
      minter,
    );
    expect(thread?.replies).toBeNull();
    expect(minter).not.toHaveBeenCalled();
  });

  it('renders a prepopulated thread’s replies inline and still mints the handle', () => {
    const thread = mapCommentThread(
      {
        has_replies: true,
        is_prepopulated: true,
        replies: [replyNode('r1'), replyNode('r2')],
        comment: { comment_id: 'UgxPrepop' },
      },
      undefined,
      mint,
    );
    expect(thread?.replies?.items.map((c) => c.id)).toEqual(['r1', 'r2']);
    expect(thread?.replies?.continuation).toBe('replies-first:handle');
  });

  it('starts a not-prepopulated thread empty, deferring page 1 to the handle', () => {
    const thread = mapCommentThread(
      { has_replies: true, comment: { comment_id: 'UgxLazy' } },
      undefined,
      mint,
    );
    expect(thread?.replies).toEqual({ items: [], continuation: 'replies-first:handle' });
  });

  it('omits the continuation when no minter is supplied', () => {
    const thread = mapCommentThread({ has_replies: true, comment: { comment_id: 'UgxNoMint' } });
    expect(thread?.replies).toEqual({ items: [] });
  });
});

describe('mapCommentThreads / mapReplyComments', () => {
  it('skips a comment: null thread instead of failing the page', () => {
    const threads = mapCommentThreads([
      { comment: { comment_id: 'a' } },
      { comment: null },
      null,
      { comment: { comment_id: 'b' } },
    ]);
    expect(threads.map((t) => t.comment.id)).toEqual(['a', 'b']);
  });

  it('degrades to an empty list, never throws, for a missing feed', () => {
    expect(mapCommentThreads(undefined)).toEqual([]);
    expect(mapReplyComments(null)).toEqual([]);
  });

  it('flattens nested reply CommentThread nodes one level', () => {
    const replies = mapReplyComments([replyNode('r1'), { comment: null }, replyNode('r2')]);
    expect(replies.map((c) => c.id)).toEqual(['r1', 'r2']);
  });
});

describe('mapCommentsTotalText', () => {
  it('prefers count, falls back to comments_count, else null', () => {
    expect(mapCommentsTotalText({ count: { text: '1,234 Comments' } })).toBe('1,234 Comments');
    expect(mapCommentsTotalText({ count: { text: '' }, comments_count: { text: '1.2K' } })).toBe(
      '1.2K',
    );
    expect(mapCommentsTotalText(null)).toBeNull();
    expect(mapCommentsTotalText({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// InnertubeYouTubeSource.getComments
// ---------------------------------------------------------------------------

describe('InnertubeYouTubeSource.getComments', () => {
  it('rejects an invalid video id with no network call', async () => {
    const getComments = vi.fn();
    const res = await sourceWith({ getComments }).getComments({ videoId: '!!', sort: 'top' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INVALID_INPUT');
    expect(getComments).not.toHaveBeenCalled();
  });

  it('bakes the sort into the request and NEVER calls applySort (P2-F6 #2)', async () => {
    for (const [sort, expected] of [
      ['top', 'TOP_COMMENTS'],
      ['newest', 'NEWEST_FIRST'],
    ] as const) {
      const page = new FakeComments([{ id: 'UgxA' }]);
      const applySort = vi.fn(() => {
        throw new Error('Could not apply sort because the comments header is missing');
      });
      Object.assign(page, { applySort });
      const getComments = vi.fn(() => Promise.resolve(page));
      const res = await sourceWith({ getComments }).getComments({ videoId: VIDEO_ID, sort });
      expect(res.ok).toBe(true);
      expect(getComments).toHaveBeenCalledWith(VIDEO_ID, expected);
      expect(applySort).not.toHaveBeenCalled();
    }
  });

  it('maps the header total and the threads', async () => {
    const page = new FakeComments([
      { id: 'UgxA', renderingPriority: 'RENDERING_PRIORITY_PINNED_COMMENT' },
      { id: 'UgxB', comment: null },
      { id: 'UgxC', hasReplies: true, prepopulated: true, inline: ['r1'] },
    ]);
    const res = await sourceWith({ getComments: () => Promise.resolve(page) }).getComments({
      videoId: VIDEO_ID,
      sort: 'top',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.header.totalText).toBe('12,483 Comments');
    expect(res.value.threads.map((t) => t.comment.id)).toEqual(['UgxA', 'UgxC']);
    expect(res.value.threads[0]?.comment.isPinned).toBe(true);
    expect(res.value.threads[0]?.replies).toBeNull();
    expect(res.value.threads[1]?.replies?.items.map((c) => c.id)).toEqual(['r1']);
    expect(res.value.threads[1]?.replies?.continuation).toMatch(/^replies-first:/);
  });

  it('never reads CommentThread.has_continuation while building a page', async () => {
    const page = new FakeComments([
      { id: 'UgxA', hasReplies: true, prepopulated: true, inline: ['r1'], morePages: [['r2']] },
      { id: 'UgxB', hasReplies: true, page1: ['r3'] },
      { id: 'UgxC' },
    ]);
    const res = await sourceWith({ getComments: () => Promise.resolve(page) }).getComments({
      videoId: VIDEO_ID,
      sort: 'top',
    });
    // Both assertions matter. `res.ok` catches the case where the throw escapes
    // to `#guard`; the counters catch it even if some future try/catch swallows
    // the throw. Remove the guard — i.e. read `has_continuation` in the mapper —
    // and the counters go non-zero here.
    expect(res.ok).toBe(true);
    expect(page.contents.map((t) => t.hasContinuationReads)).toEqual([0, 0, 0]);
    expect(page.contents.map((t) => t.getRepliesCalls)).toEqual([0, 0, 0]);
  });

  it('a prepopulated thread’s replies arrive with no network call at all', async () => {
    const page = new FakeComments([
      { id: 'UgxPrepop', hasReplies: true, prepopulated: true, inline: ['r1', 'r2'] },
    ]);
    const src = sourceWith({ getComments: () => Promise.resolve(page) });
    const first = await src.getComments({ videoId: VIDEO_ID, sort: 'top' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const thread = first.value.threads[0];
    expect(thread?.replies?.items.map((c) => c.id)).toEqual(['r1', 'r2']);
    expect(page.contents[0]?.networkCalls).toBe(0);

    // …and following the handle is still request-free, because `getReplies()`
    // short-circuits for a prepopulated thread (`CommentThread.js:50`).
    const handle = thread?.replies?.continuation;
    expect(handle).toBeDefined();
    if (handle == null) return;
    const replies = await src.getCommentReplies({ handle });
    expect(replies.ok && replies.value.items.map((c) => c.id)).toEqual(['r1', 'r2']);
    expect(page.contents[0]?.networkCalls).toBe(0);
    expect(page.contents[0]?.getRepliesCalls).toBe(1);
  });

  it('paginates page 1 → page 2 onto a FRESH Comments object', async () => {
    const page = new FakeComments([{ id: 'UgxA' }], [[{ id: 'UgxB' }]]);
    const src = sourceWith({ getComments: () => Promise.resolve(page) });

    const first = await src.getComments({ videoId: VIDEO_ID, sort: 'top' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const handle = first.value.continuation;
    expect(handle).toMatch(/^comments:/);
    if (handle == null) return;

    const second = await src.getComments({ videoId: VIDEO_ID, sort: 'top', continuation: handle });
    expect(page.getContinuationCalls).toBe(1);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.threads.map((t) => t.comment.id)).toEqual(['UgxB']);
    // Page 2 is a different object, so it gets its own handle — the page-1
    // handle is untouched and still resolves to page 1's object.
    expect(second.value.continuation).toBeUndefined();
    expect(second.value.header.totalText).toBe('12,483 Comments');

    const replay = await src.getComments({ videoId: VIDEO_ID, sort: 'top', continuation: handle });
    expect(replay.ok && replay.value.threads.map((t) => t.comment.id)).toEqual(['UgxB']);
    expect(page.getContinuationCalls).toBe(2);
  });

  it('mints no continuation on the last page', async () => {
    const page = new FakeComments([{ id: 'UgxA' }]);
    const res = await sourceWith({ getComments: () => Promise.resolve(page) }).getComments({
      videoId: VIDEO_ID,
      sort: 'top',
    });
    expect(res.ok && res.value.continuation).toBeUndefined();
  });

  it('rejects a stale, unknown or cross-kind continuation handle', async () => {
    const getComments = vi.fn();
    const src = sourceWith({ getComments });
    for (const continuation of [
      'comments:deadbeef',
      'search:deadbeef',
      'replies-first:deadbeef',
      'nonsense',
    ]) {
      const res = await src.getComments({ videoId: VIDEO_ID, sort: 'top', continuation });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('INVALID_INPUT');
    }
    expect(getComments).not.toHaveBeenCalled();
  });

  it('rejects a LIVE replies-first handle fed to yt:comments’ kind', async () => {
    // The sharp form of the cross-kind case: not a made-up string, but a handle
    // this very source minted a moment ago, whose uuid really is in the store —
    // only under a different kind. It must not be able to reach `getContinuation()`.
    const page = new FakeComments(
      [{ id: 'UgxA', hasReplies: true, page1: ['r1'] }],
      [[{ id: 'UgxB' }]],
    );
    const src = sourceWith({ getComments: () => Promise.resolve(page) });
    const first = await src.getComments({ videoId: VIDEO_ID, sort: 'top' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const repliesHandle = first.value.threads[0]?.replies?.continuation;
    expect(repliesHandle).toMatch(/^replies-first:/);
    if (repliesHandle == null) return;

    const res = await src.getComments({
      videoId: VIDEO_ID,
      sort: 'top',
      continuation: repliesHandle,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INVALID_INPUT');
    expect(page.getContinuationCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// InnertubeYouTubeSource.getCommentReplies — the three-state machine
// ---------------------------------------------------------------------------

/** Resolve `getComments` once and hand back the source plus the page-1 result. */
async function commentsWith(
  threads: FakeThreadInit[],
): Promise<{ src: InnertubeYouTubeSource; page: FakeComments; handles: (string | undefined)[] }> {
  const page = new FakeComments(threads);
  const src = sourceWith({ getComments: () => Promise.resolve(page) });
  const res = await src.getComments({ videoId: VIDEO_ID, sort: 'top' });
  if (!res.ok) throw new Error('fixture setup failed');
  return { src, page, handles: res.value.threads.map((t) => t.replies?.continuation) };
}

describe('InnertubeYouTubeSource.getCommentReplies', () => {
  it('replies-first fetches page 1 and hands back a replies-more handle', async () => {
    const { src, page, handles } = await commentsWith([
      { id: 'UgxA', hasReplies: true, page1: ['r1', 'r2'], morePages: [['r3']] },
    ]);
    const handle = handles[0];
    expect(handle).toMatch(/^replies-first:/);
    if (handle == null) return;

    const res = await src.getCommentReplies({ handle });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.items.map((c) => c.id)).toEqual(['r1', 'r2']);
    expect(res.value.continuation).toMatch(/^replies-more:/);
    expect(page.contents[0]?.getRepliesCalls).toBe(1);
    // `has_continuation` is read exactly once — after `getReplies()`, never before.
    expect(page.contents[0]?.hasContinuationReads).toBe(1);
  });

  it('calling replies-first TWICE returns the same page (the idempotency the design rests on)', async () => {
    const { src, page, handles } = await commentsWith([
      { id: 'UgxA', hasReplies: true, page1: ['r1', 'r2'], morePages: [['r3']] },
    ]);
    const handle = handles[0];
    if (handle == null) throw new Error('no replies-first handle');

    const first = await src.getCommentReplies({ handle });
    const second = await src.getCommentReplies({ handle });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    // Identical items AND an identical `replies-more:` handle. The handle part
    // is what proves the cursor did not advance: the store dedupes by object
    // identity per kind, so re-`put`ting the same thread returns the handle it
    // already had rather than minting a second one pointing at a newer state.
    expect(second.value).toEqual(first.value);
    expect(second.value.continuation).toBe(first.value.continuation);
    expect(page.contents[0]?.getRepliesCalls).toBe(2);
  });

  it('walks replies-first → replies-more → replies-more into three distinct pages', async () => {
    const { src, handles } = await commentsWith([
      {
        id: 'UgxA',
        hasReplies: true,
        page1: ['r1', 'r2'],
        morePages: [
          ['r3', 'r4'],
          ['r5', 'r6'],
        ],
      },
    ]);
    const seen: string[][] = [];
    let handle = handles[0];
    for (let hop = 0; hop < 3; hop += 1) {
      expect(handle).toBeDefined();
      if (handle == null) return;
      const res = await src.getCommentReplies({ handle });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      seen.push(res.value.items.map((c) => c.id));
      handle = res.value.continuation;
    }

    expect(seen).toEqual([
      ['r1', 'r2'],
      ['r3', 'r4'],
      ['r5', 'r6'],
    ]);
    const flat = seen.flat();
    expect(new Set(flat).size).toBe(flat.length);
    // Three pages, and the chain terminates rather than looping.
    expect(handle).toBeUndefined();
  });

  it('a replies-more page is a fresh object, so replaying its handle repeats it', async () => {
    const { src, handles } = await commentsWith([
      { id: 'UgxA', hasReplies: true, page1: ['r1'], morePages: [['r2'], ['r3']] },
    ]);
    const first = await src.getCommentReplies({ handle: handles[0] ?? '' });
    expect(first.ok).toBe(true);
    if (!first.ok || first.value.continuation == null) return;
    const more = first.value.continuation;

    const a = await src.getCommentReplies({ handle: more });
    const b = await src.getCommentReplies({ handle: more });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.items.map((c) => c.id)).toEqual(['r2']);
    // `CommentsContinuation.getContinuation()` builds a new object each call, so
    // the two page-3 handles differ by design — what must not differ is the page.
    expect(b.value.items.map((c) => c.id)).toEqual(['r2']);
    expect(a.value.continuation).toMatch(/^replies-more:/);
    expect(b.value.continuation).toMatch(/^replies-more:/);
  });

  it('mints no replies-more handle when the thread has exactly one reply page', async () => {
    const { src, page, handles } = await commentsWith([
      { id: 'UgxA', hasReplies: true, page1: ['r1'] },
    ]);
    const res = await src.getCommentReplies({ handle: handles[0] ?? '' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.items.map((c) => c.id)).toEqual(['r1']);
    expect(res.value.continuation).toBeUndefined();
    expect(page.contents[0]?.hasContinuationReads).toBe(1);
  });

  it('degrades to a final empty page when getReplies() leaves replies unloaded', async () => {
    // `getReplies()` returns without assigning `this.replies` when the response
    // carries no AppendContinuationItemsAction (`CommentThread.js:61-63`), and
    // `has_continuation` throws in exactly that case. There is no page we could
    // reach — `getContinuation()` refuses for the same reason — so it is a final
    // page, not an error.
    const { src, page, handles } = await commentsWith([
      { id: 'UgxA', hasReplies: true, page1: ['r1'], leaveRepliesUnset: true, morePages: [['r2']] },
    ]);
    const res = await src.getCommentReplies({ handle: handles[0] ?? '' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual({ items: [] });
    expect(page.contents[0]?.hasContinuationReads).toBe(1);
  });

  it('rejects a handle of the wrong kind, including a yt:comments handle', async () => {
    const page = new FakeComments([{ id: 'UgxA' }], [[{ id: 'UgxB' }]]);
    const src = sourceWith({ getComments: () => Promise.resolve(page) });
    const first = await src.getComments({ videoId: VIDEO_ID, sort: 'top' });
    const commentsHandle = first.ok ? first.value.continuation : undefined;
    expect(commentsHandle).toMatch(/^comments:/);

    for (const handle of [commentsHandle ?? '', 'search:abc', 'channel:abc', 'nonsense', '']) {
      const res = await src.getCommentReplies({ handle });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('INVALID_INPUT');
        expect(res.error.hint).toBe('Reload the comments to keep reading this thread.');
      }
    }
  });

  it('rejects a stale or forged replies handle', async () => {
    const { src, handles } = await commentsWith([
      { id: 'UgxA', hasReplies: true, page1: ['r1'], morePages: [['r2']] },
    ]);
    const first = handles[0] ?? '';
    const page1 = await src.getCommentReplies({ handle: first });
    const more = page1.ok ? (page1.value.continuation ?? '') : '';

    // Never minted.
    const stale = await src.getCommentReplies({ handle: 'replies-first:deadbeef' });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error.code).toBe('INVALID_INPUT');
      expect(stale.error.hint).toBe('Reload the comments to keep reading this thread.');
    }

    // Swapping the kind prefix on a real handle does not smuggle it into the
    // other branch: the store's per-kind namespacing rejects the uuid outright,
    // so `getReplies()` can never be reached through a `replies-more:` id.
    const swapped = await src.getCommentReplies({
      handle: `replies-first:${more.slice('replies-more:'.length)}`,
    });
    expect(swapped.ok).toBe(false);
    const swappedBack = await src.getCommentReplies({
      handle: `replies-more:${first.slice('replies-first:'.length)}`,
    });
    expect(swappedBack.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FakeYouTubeSource — fixtures (hand-authored, A20)
// ---------------------------------------------------------------------------

describe('FakeYouTubeSource.getComments', () => {
  const fake = new FakeYouTubeSource();

  it('serves the top-sorted first page with header, flags and timestamps', async () => {
    const res = await fake.getComments({ videoId: VIDEO_ID, sort: 'top' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.header.totalText).toBe('12,483 Comments');

    // Six nodes in the fixture, one of which has `comment: null` → skipped.
    expect(res.value.threads.map((t) => t.comment.id)).toEqual([
      'UgxFixturePinned00000001',
      'UgxFixturePrepop00000002',
      'UgxFixtureManyReplies0003',
      'UgxFixtureTimestamps0004',
      'UgxFixtureDegraded000006',
    ]);

    const pinned = res.value.threads[0]?.comment;
    expect(pinned).toMatchObject({
      isPinned: true,
      isHearted: true,
      authorIsUploader: true,
      authorIsVerified: true,
      likeCount: 8400,
      replyCount: 0,
    });
    expect(res.value.threads[0]?.replies).toBeNull();

    expect(res.value.threads[3]?.comment.textTimestamps.map((t) => t.seconds)).toEqual([
      42, 3909, 133,
    ]);

    // Every optional field absent → a partial Comment, not a failure.
    expect(res.value.threads[4]?.comment).toMatchObject({
      text: '',
      likeCount: null,
      replyCount: 0,
      publishedText: null,
    });
  });

  it('renders the prepopulated thread’s reply inline and mints a replies-first handle', async () => {
    const res = await fake.getComments({ videoId: VIDEO_ID, sort: 'top' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const prepop = res.value.threads[1];
    expect(prepop?.replies?.items.map((c) => c.id)).toEqual(['UgxFixtureReplyPrepop0001']);
    expect(prepop?.replies?.continuation).toBe('replies-first:comment-replies-single');
  });

  it('serves page 2 through the continuation, with disjoint ids', async () => {
    const first = await fake.getComments({ videoId: VIDEO_ID, sort: 'top' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const handle = first.value.continuation;
    expect(handle).toBe('comments-page2');
    if (handle == null) return;

    const second = await fake.getComments({ videoId: VIDEO_ID, sort: 'top', continuation: handle });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.continuation).toBeUndefined();
    const ids = [...first.value.threads, ...second.value.threads].map((t) => t.comment.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('serves a different page for the newest sort', async () => {
    const res = await fake.getComments({ videoId: VIDEO_ID, sort: 'newest' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.threads.map((t) => t.comment.id)).toEqual([
      'UgxFixtureNewest00000001',
      'UgxFixtureNewest00000002',
    ]);
  });

  it('errors for a video with no comments fixture', async () => {
    const res = await fake.getComments({ videoId: 'LXb3EKWsInQ', sort: 'top' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('YT_UNAVAILABLE');
  });
});

describe('FakeYouTubeSource.getCommentReplies', () => {
  const fake = new FakeYouTubeSource();

  it('walks a two-page reply chain with no duplicate ids, idempotently', async () => {
    const first = await fake.getCommentReplies({
      handle: 'replies-first:comment-replies-many-p1',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.items.map((c) => c.id)).toEqual([
      'UgxFixtureReplyMany0p1a',
      'UgxFixtureReplyMany0p1b',
    ]);
    expect(first.value.continuation).toBe('replies-more:comment-replies-many-p2');

    const replay = await fake.getCommentReplies({
      handle: 'replies-first:comment-replies-many-p1',
    });
    expect(replay.ok && replay.value).toEqual(first.value);

    const second = await fake.getCommentReplies({ handle: first.value.continuation ?? '' });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.continuation).toBeUndefined();
    const ids = [...first.value.items, ...second.value.items].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('rejects a wrong-kind or unknown handle', async () => {
    for (const handle of [
      'comments-page2',
      'comments:abc',
      'search:abc',
      '',
      'replies-first:nope',
      'replies-more:nope',
    ]) {
      const res = await fake.getCommentReplies({ handle });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('INVALID_INPUT');
        expect(res.error.hint).toBe('Reload the comments to keep reading this thread.');
      }
    }
  });
});
