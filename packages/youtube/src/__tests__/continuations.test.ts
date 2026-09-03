import { describe, expect, it } from 'vitest';
import { ContinuationStore } from '../innertube/continuations.js';

describe('ContinuationStore', () => {
  it('round-trips a stored value by handle', () => {
    const store = new ContinuationStore();
    const feed = { page: 1 };
    const handle = store.put(feed);
    expect(typeof handle).toBe('string');
    expect(store.get(handle)).toBe(feed);
  });

  it('returns undefined for an unknown handle', () => {
    expect(new ContinuationStore().get('nope')).toBeUndefined();
  });

  it('expires entries after the TTL', () => {
    let now = 1_000_000;
    const store = new ContinuationStore({ ttlMs: 5000, now: () => now });
    const handle = store.put({});
    now += 4999;
    expect(store.get(handle)).toBeDefined();
    now += 2;
    expect(store.get(handle)).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('evicts the oldest entry past the cap (LRU)', () => {
    const store = new ContinuationStore({ cap: 2 });
    const a = store.put('a');
    const b = store.put('b');
    // touch `a` so `b` is now least-recently-used
    expect(store.get(a)).toBe('a');
    const c = store.put('c');
    expect(store.get(b)).toBeUndefined();
    expect(store.get(a)).toBe('a');
    expect(store.get(c)).toBe('c');
    expect(store.size).toBe(2);
  });
});
