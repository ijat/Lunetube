import { describe, expect, it } from 'vitest';
import { ContinuationStore } from '../innertube/continuations.js';

describe('ContinuationStore', () => {
  it('round-trips a stored value by (kind, handle)', () => {
    const store = new ContinuationStore();
    const feed = { page: 1 };
    const handle = store.put('search', feed);
    expect(handle.startsWith('search:')).toBe(true);
    expect(store.get('search', handle)).toBe(feed);
  });

  it('returns undefined for an unknown handle', () => {
    expect(new ContinuationStore().get('search', 'search:nope')).toBeUndefined();
  });

  // (i) cross-kind get — a handle minted for one kind must not resolve for another
  it('refuses a handle whose prefix does not match the kind', () => {
    const store = new ContinuationStore();
    const obj = { thread: true };
    const handle = store.put('comments', obj);

    expect(store.get('channel', handle)).toBeUndefined();
    expect(store.get('replies-more', handle)).toBeUndefined();
    // ...but the matching kind still resolves it (non-vacuous)
    expect(store.get('comments', handle)).toBe(obj);
  });

  it('does not confuse the two reply kinds', () => {
    const store = new ContinuationStore();
    const first = store.put('replies-first', { a: 1 });
    const more = store.put('replies-more', { b: 2 });
    expect(store.get('replies-more', first)).toBeUndefined();
    expect(store.get('replies-first', more)).toBeUndefined();
    expect(store.get('replies-first', first)).toEqual({ a: 1 });
    expect(store.get('replies-more', more)).toEqual({ b: 2 });
  });

  // (ii) identity dedupe — same object, same kind → same handle
  it('returns the same handle for the same object under the same kind', () => {
    const store = new ContinuationStore();
    const feed = { mutatedInPlace: true };

    const h1 = store.put('channel', feed);
    const h2 = store.put('channel', feed);
    expect(h2).toBe(h1);
    expect(store.size).toBe(1);

    // a different object → a different handle (non-vacuous)
    expect(store.put('channel', { other: true })).not.toBe(h1);
    // the same object under a different kind → a different handle
    expect(store.put('playlist', feed)).not.toBe(h1);
  });

  it('does not dedupe non-object values', () => {
    const store = new ContinuationStore();
    const a = store.put('search', 'token');
    const b = store.put('search', 'token');
    expect(b).not.toBe(a);
  });

  // (iii) TTL expiry still holds and clears the WeakMap entry
  it('expires entries after the TTL and forgets the identity mapping', () => {
    let now = 1_000_000;
    const store = new ContinuationStore({ ttlMs: 5000, now: () => now });
    const feed = { page: 1 };
    const handle = store.put('search', feed);

    now += 4999;
    expect(store.get('search', handle)).toBe(feed);
    now += 2;
    expect(store.get('search', handle)).toBeUndefined();
    expect(store.size).toBe(0);

    // The stale identity mapping was cleared: re-putting the same object mints
    // a brand-new handle rather than handing back the expired one.
    const reHandle = store.put('search', feed);
    expect(reHandle).not.toBe(handle);
    expect(store.get('search', reHandle)).toBe(feed);
  });

  // (iii) LRU eviction still holds and clears the WeakMap entry
  it('evicts the least-recently-used entry past the cap and forgets its identity', () => {
    const store = new ContinuationStore({ cap: 2 });
    const objA = { id: 'a' };
    const objB = { id: 'b' };
    const objC = { id: 'c' };

    const a = store.put('search', objA);
    const b = store.put('search', objB);
    // touch `a` so `objB` becomes least-recently-used
    expect(store.get('search', a)).toBe(objA);
    store.put('search', objC);

    expect(store.size).toBe(2);
    expect(store.get('search', b)).toBeUndefined(); // evicted
    expect(store.get('search', a)).toBe(objA); // survived, still same handle
    expect(store.put('search', objA)).toBe(a); // identity mapping intact
    // `objB` was evicted — its identity mapping is gone, so a re-put mints fresh
    expect(store.put('search', objB)).not.toBe(b);
  });

  // F1 — the default cap must survive a realistic comment-browsing session:
  // N comment pages, each minting one `comments:` handle plus ~20 per-thread
  // `replies-first:` handles, must not evict page 1's reply handles.
  it('keeps page-1 reply handles resolvable across many comment pages (default cap)', () => {
    const store = new ContinuationStore();
    const page1ReplyHandles: string[] = [];

    for (let page = 0; page < 10; page += 1) {
      store.put('comments', { page });
      for (let thread = 0; thread < 20; thread += 1) {
        const marker = { page, thread };
        const handle = store.put('replies-first', marker);
        if (page === 0) page1ReplyHandles.push(handle);
      }
    }

    // 10 pages x 21 = 210 entries, well under the 1000 cap → nothing evicted.
    for (const handle of page1ReplyHandles) {
      expect(store.get('replies-first', handle)).toBeDefined();
    }
  });

  it('clear() drops every entry and resets identity dedupe', () => {
    const store = new ContinuationStore();
    const feed = { page: 1 };
    const handle = store.put('search', feed);
    store.clear();
    expect(store.size).toBe(0);
    expect(store.get('search', handle)).toBeUndefined();
    expect(store.put('search', feed)).not.toBe(handle);
  });
});
