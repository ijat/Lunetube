import { describe, expect, it } from 'vitest';
import type { Comment, CommentThread } from '@lunetube/shared';
import { flattenComments, type ReplyState } from '../flattenComments.js';

/**
 * `flattenComments` is the whole correctness surface of P2-10 that can be
 * tested off-DOM, so it is tested exhaustively over the row-kind matrix:
 * {collapsed, expanded with 0 / 1 / N replies, expanded mid-load, expanded with
 * an error, duplicate id across pages} × {prepopulated, not}.
 *
 * The property the virtualizer actually depends on — **no key that survives a
 * splice ever changes** — gets its own test, because a key regression is
 * invisible in jsdom (no layout) and only shows up as a visibly jumping list in
 * a real browser.
 */

function comment(id: string, over: Partial<Comment> = {}): Comment {
  return {
    id,
    author: { id: `chan-${id}`, name: `Author ${id}`, avatarUrl: null },
    authorIsUploader: false,
    authorIsVerified: false,
    text: `body ${id}`,
    textTimestamps: [],
    likeCount: null,
    publishedText: null,
    isHearted: false,
    isPinned: false,
    replyCount: 0,
    ...over,
  };
}

function thread(id: string, replies: CommentThread['replies'] = null): CommentThread {
  const replyCount = replies === null ? 0 : Math.max(replies.items.length, 1);
  return { comment: comment(id, { replyCount }), replies };
}

function replyState(over: Partial<ReplyState> = {}): ReplyState {
  return { items: [], hasMore: false, loading: false, error: null, ...over };
}

const NONE: ReadonlySet<string> = new Set();

const kinds = (rows: ReturnType<typeof flattenComments>) => rows.map((r) => r.kind);
const keys = (rows: ReturnType<typeof flattenComments>) => rows.map((r) => r.key);

describe('flattenComments — collapsed', () => {
  it('emits one row per reply-less thread and nothing else', () => {
    const rows = flattenComments([thread('a'), thread('b')], NONE, {});
    expect(kinds(rows)).toEqual(['comment', 'comment']);
    expect(keys(rows)).toEqual(['c:a', 'c:b']);
  });

  it('emits a collapsed toggle row for a thread with replies, and no reply rows', () => {
    const t = thread('a', { items: [comment('a1')], continuation: 'replies-first:h' });
    const rows = flattenComments([t], NONE, {});
    expect(kinds(rows)).toEqual(['comment', 'show-replies']);
    const toggle = rows[1];
    expect(toggle).toMatchObject({ kind: 'show-replies', threadKey: 'a', expanded: false });
  });

  it('ignores reply state for a collapsed thread', () => {
    const t = thread('a', { items: [], continuation: 'replies-first:h' });
    const rows = flattenComments([t], NONE, {
      a: replyState({ items: [comment('a1')], hasMore: true, loading: true }),
    });
    expect(kinds(rows)).toEqual(['comment', 'show-replies']);
  });

  it('reports the largest honest reply count', () => {
    const withCount: CommentThread = {
      comment: comment('a', { replyCount: 1400 }),
      replies: { items: [comment('a1')], continuation: 'replies-first:h' },
    };
    expect(flattenComments([withCount], NONE, {})[1]).toMatchObject({ count: 1400 });

    // A thread whose upstream count failed to parse (0) still reports what it has.
    const noCount: CommentThread = {
      comment: comment('b', { replyCount: 0 }),
      replies: { items: [comment('b1'), comment('b2')] },
    };
    expect(flattenComments([noCount], NONE, {})[1]).toMatchObject({ count: 2 });
  });
});

describe('flattenComments — expanded', () => {
  it('expanded with 0 replies emits the toggle and no reply rows', () => {
    const t = thread('a', { items: [], continuation: 'replies-first:h' });
    const rows = flattenComments([t], new Set(['a']), { a: replyState() });
    expect(kinds(rows)).toEqual(['comment', 'show-replies']);
    expect(rows[1]).toMatchObject({ expanded: true });
  });

  it('expanded with 1 inline (prepopulated) reply splices it after the toggle', () => {
    const t = thread('a', { items: [comment('a1')], continuation: 'replies-first:h' });
    const rows = flattenComments([t], new Set(['a']), {});
    expect(kinds(rows)).toEqual(['comment', 'show-replies', 'reply']);
    expect(keys(rows)).toEqual(['c:a', 't:a', 'r:a:a1']);
    expect(rows[2]).toMatchObject({ depth: 1, threadKey: 'a' });
  });

  it('expanded with N fetched replies emits them in page order', () => {
    const t = thread('a', { items: [], continuation: 'replies-first:h' });
    const rows = flattenComments([t], new Set(['a']), {
      a: replyState({ items: [comment('a1'), comment('a2'), comment('a3')] }),
    });
    expect(keys(rows)).toEqual(['c:a', 't:a', 'r:a:a1', 'r:a:a2', 'r:a:a3']);
  });

  it('emits a more-replies row when another reply page exists', () => {
    const t = thread('a', { items: [], continuation: 'replies-first:h' });
    const rows = flattenComments([t], new Set(['a']), {
      a: replyState({ items: [comment('a1')], hasMore: true }),
    });
    expect(kinds(rows)).toEqual(['comment', 'show-replies', 'reply', 'more-replies']);
    expect(rows[3]).toMatchObject({ key: 'm:a', loading: false, error: null });
  });

  it('expanded mid-load (no replies yet) still emits a more-replies row so the wait is visible', () => {
    const t = thread('a', { items: [], continuation: 'replies-first:h' });
    const rows = flattenComments([t], new Set(['a']), { a: replyState({ loading: true }) });
    expect(kinds(rows)).toEqual(['comment', 'show-replies', 'more-replies']);
    expect(rows[2]).toMatchObject({ loading: true });
  });

  it('expanded mid-load of page 2 keeps page 1 rendered', () => {
    const t = thread('a', { items: [], continuation: 'replies-first:h' });
    const rows = flattenComments([t], new Set(['a']), {
      a: replyState({ items: [comment('a1')], loading: true, hasMore: true }),
    });
    expect(kinds(rows)).toEqual(['comment', 'show-replies', 'reply', 'more-replies']);
    expect(rows[3]).toMatchObject({ loading: true });
  });

  it('surfaces a reply error as a more-replies row even with nothing loaded', () => {
    const t = thread('a', { items: [], continuation: 'replies-first:h' });
    const rows = flattenComments([t], new Set(['a']), {
      a: replyState({ error: 'This comment thread refreshed.' }),
    });
    expect(kinds(rows)).toEqual(['comment', 'show-replies', 'more-replies']);
    expect(rows[2]).toMatchObject({ error: 'This comment thread refreshed.' });
  });

  it('emits no more-replies row when the last page is loaded and clean', () => {
    const t = thread('a', { items: [], continuation: 'replies-first:h' });
    const rows = flattenComments([t], new Set(['a']), {
      a: replyState({ items: [comment('a1')] }),
    });
    expect(kinds(rows)).toEqual(['comment', 'show-replies', 'reply']);
  });

  it('expanding a thread with no reply handle falls back to the inline replies only', () => {
    const t = thread('a', { items: [comment('a1'), comment('a2')] });
    const rows = flattenComments([t], new Set(['a']), {});
    expect(keys(rows)).toEqual(['c:a', 't:a', 'r:a:a1', 'r:a:a2']);
  });

  it('expanding an id that is not in the list changes nothing', () => {
    const rows = flattenComments([thread('a')], new Set(['zzz']), {});
    expect(keys(rows)).toEqual(['c:a']);
  });
});

describe('flattenComments — duplicates', () => {
  it('drops a thread whose id already appeared (comment pagination can repeat one)', () => {
    const rows = flattenComments([thread('a'), thread('b'), thread('a')], NONE, {});
    expect(keys(rows)).toEqual(['c:a', 'c:b']);
  });

  it('drops a thread with no id', () => {
    const rows = flattenComments([thread(''), thread('a')], NONE, {});
    expect(keys(rows)).toEqual(['c:a']);
  });

  it('dedupes the prepopulated page-1 replies against the same page fetched by handle', () => {
    // The real overlap: `mapCommentThread` puts page 1 inline AND mints a
    // `replies-first:` handle that re-fetches exactly that page.
    const inline = [comment('a1'), comment('a2')];
    const t = thread('a', { items: inline, continuation: 'replies-first:h' });
    const rows = flattenComments([t], new Set(['a']), {
      a: replyState({ items: [comment('a1'), comment('a2'), comment('a3')] }),
    });
    expect(keys(rows)).toEqual(['c:a', 't:a', 'r:a:a1', 'r:a:a2', 'r:a:a3']);
  });

  it('dedupes a reply repeated across two fetched pages', () => {
    const t = thread('a', { items: [], continuation: 'replies-first:h' });
    const rows = flattenComments([t], new Set(['a']), {
      a: replyState({ items: [comment('a1'), comment('a2'), comment('a2'), comment('a3')] }),
    });
    expect(keys(rows)).toEqual(['c:a', 't:a', 'r:a:a1', 'r:a:a2', 'r:a:a3']);
  });

  it('drops a reply with no id', () => {
    const t = thread('a', { items: [comment(''), comment('a1')] });
    const rows = flattenComments([t], new Set(['a']), {});
    expect(keys(rows)).toEqual(['c:a', 't:a', 'r:a:a1']);
  });

  it('lets the same reply id appear under two different threads', () => {
    const a = thread('a', { items: [comment('shared')] });
    const b = thread('b', { items: [comment('shared')] });
    const rows = flattenComments([a, b], new Set(['a', 'b']), {});
    expect(keys(rows)).toEqual(['c:a', 't:a', 'r:a:shared', 'c:b', 't:b', 'r:b:shared']);
  });

  it('never emits a duplicate key across the whole matrix', () => {
    const threads = [
      thread('a', { items: [comment('a1')], continuation: 'replies-first:ha' }),
      thread('b'),
      thread('c', { items: [], continuation: 'replies-first:hc' }),
      thread('a'), // repeated thread
    ];
    const rows = flattenComments(
      threads,
      new Set(['a', 'c']),
      {
        a: replyState({ items: [comment('a1'), comment('a2')], hasMore: true }),
        c: replyState({ items: [comment('c1')], loading: true }),
      },
      { hasMoreComments: true },
    );
    expect(new Set(keys(rows)).size).toBe(rows.length);
  });
});

describe('flattenComments — the splice must not disturb other keys (I2)', () => {
  const threads = [
    thread('a', { items: [], continuation: 'replies-first:ha' }),
    thread('b', { items: [], continuation: 'replies-first:hb' }),
    thread('c'),
  ];

  it('keeps every pre-existing key, and its relative order, when a thread expands', () => {
    const before = flattenComments(threads, NONE, {});
    const after = flattenComments(threads, new Set(['a']), {
      a: replyState({ items: [comment('a1'), comment('a2')] }),
    });

    expect(keys(before)).toEqual(['c:a', 't:a', 'c:b', 't:b', 'c:c']);
    expect(keys(after)).toEqual(['c:a', 't:a', 'r:a:a1', 'r:a:a2', 'c:b', 't:b', 'c:c']);

    // Every key that existed before still exists, in the same relative order —
    // this is exactly what lets virtual-core find each row's measured height
    // under an unchanged key after the array grew in the middle.
    const survivors = keys(after).filter((k) => keys(before).includes(k));
    expect(survivors).toEqual(keys(before));
  });

  it('is symmetric: collapsing restores the pre-splice array exactly', () => {
    const before = flattenComments(threads, NONE, {});
    const expandedRows = flattenComments(threads, new Set(['a']), {
      a: replyState({ items: [comment('a1')] }),
    });
    const collapsed = flattenComments(threads, NONE, {
      a: replyState({ items: [comment('a1')] }),
    });
    expect(keys(collapsed)).toEqual(keys(before));
    expect(expandedRows.length).toBeGreaterThan(collapsed.length);
  });

  it('a second reply page appends without touching the first page of keys', () => {
    const page1 = flattenComments(threads, new Set(['a']), {
      a: replyState({ items: [comment('a1')], hasMore: true }),
    });
    const page2 = flattenComments(threads, new Set(['a']), {
      a: replyState({ items: [comment('a1'), comment('a2')] }),
    });
    expect(keys(page1)).toEqual(['c:a', 't:a', 'r:a:a1', 'm:a', 'c:b', 't:b', 'c:c']);
    expect(keys(page2)).toEqual(['c:a', 't:a', 'r:a:a1', 'r:a:a2', 'c:b', 't:b', 'c:c']);
  });

  it('appending a comment page leaves every existing key untouched', () => {
    const before = flattenComments(threads, new Set(['a']), {
      a: replyState({ items: [comment('a1')] }),
    });
    const after = flattenComments([...threads, thread('d')], new Set(['a']), {
      a: replyState({ items: [comment('a1')] }),
    });
    expect(keys(after).slice(0, keys(before).length)).toEqual(keys(before));
  });

  it('no key contains an array index', () => {
    const rows = flattenComments(
      threads,
      new Set(['a', 'b']),
      {
        a: replyState({ items: [comment('a1'), comment('a2')], hasMore: true }),
        b: replyState({ items: [comment('b1')] }),
      },
      { hasMoreComments: true },
    );
    for (const [index, key] of keys(rows).entries()) {
      expect(key.endsWith(`:${index}`)).toBe(false);
    }
    expect(keys(rows)).toEqual([
      'c:a',
      't:a',
      'r:a:a1',
      'r:a:a2',
      'm:a',
      'c:b',
      't:b',
      'r:b:b1',
      'c:c',
      'load-more',
    ]);
  });
});

describe('flattenComments — load-more', () => {
  it('is omitted by default and last when asked for', () => {
    expect(kinds(flattenComments([thread('a')], NONE, {}))).toEqual(['comment']);
    const rows = flattenComments([thread('a')], NONE, {}, { hasMoreComments: true });
    expect(kinds(rows)).toEqual(['comment', 'load-more']);
    expect(rows.at(-1)).toMatchObject({ key: 'load-more' });
  });

  it('is the only row when there are no threads yet', () => {
    expect(keys(flattenComments([], NONE, {}, { hasMoreComments: true }))).toEqual(['load-more']);
    expect(flattenComments([], NONE, {})).toEqual([]);
  });
});

describe('flattenComments — purity', () => {
  it('does not mutate its inputs', () => {
    const t = thread('a', { items: [comment('a1')], continuation: 'replies-first:h' });
    const threads = [t];
    const expanded = new Set(['a']);
    const state = { a: replyState({ items: [comment('a2')], hasMore: true }) };
    const snapshot = JSON.stringify({ threads, expanded: [...expanded], state });

    flattenComments(threads, expanded, state, { hasMoreComments: true });

    expect(JSON.stringify({ threads, expanded: [...expanded], state })).toBe(snapshot);
  });

  it('is deterministic', () => {
    const threads = [thread('a', { items: [comment('a1')], continuation: 'replies-first:h' })];
    const args = [threads, new Set(['a']), { a: replyState({ hasMore: true }) }] as const;
    expect(flattenComments(...args)).toEqual(flattenComments(...args));
  });
});
