import { describe, expect, it } from 'vitest';
import { columnsForWidth } from '../layout.js';

/**
 * NOTE FOR FUTURE READERS: this file, and `VideoCard.test.tsx` beside it, are
 * the ONLY jsdom tests P2-7 ships, on purpose. `VirtualGrid` / `VirtualList` are
 * NOT tested here — jsdom has no layout engine (every element reports
 * `clientWidth === 0` / `offsetHeight === 0`) and no `ResizeObserver`, so a
 * jsdom "virtualization test" would assert that a grid of zero-height rows
 * renders zero rows: vacuously green against a correct implementation and a
 * broken one alike. Real virtualization coverage is Playwright, in P2-11.
 *
 * That is exactly why the responsive-column decision was extracted into a pure
 * function: the arithmetic is the part that can be pinned without a layout
 * engine, and it is the part that decides whether the grid drops a row at one
 * window width and not another.
 */

/** The mockup's Direction-B browse grid: `minmax(300px, 1fr)`, `gap: 28px 22px`. */
const MIN = 300;
const GAP = 22;

describe('columnsForWidth', () => {
  it('fits n columns exactly at the width n columns need', () => {
    // n columns need n*MIN + (n-1)*GAP.
    for (let n = 1; n <= 8; n++) {
      const exact = n * MIN + (n - 1) * GAP;
      expect(columnsForWidth(exact, MIN, GAP)).toBe(n);
    }
  });

  it('does not add a column until the whole next column AND its gutter fit', () => {
    for (let n = 1; n <= 8; n++) {
      const exact = n * MIN + (n - 1) * GAP;
      // One pixel short of n+1 columns still shows n.
      expect(columnsForWidth(exact + MIN + GAP - 1, MIN, GAP)).toBe(n);
      // And the very next pixel adds it.
      expect(columnsForWidth(exact + MIN + GAP, MIN, GAP)).toBe(n + 1);
    }
  });

  it('pins the Direction-B breakpoints a real window walks through', () => {
    expect(columnsForWidth(300, MIN, GAP)).toBe(1);
    expect(columnsForWidth(621, MIN, GAP)).toBe(1); // 622 is the 2-column threshold
    expect(columnsForWidth(622, MIN, GAP)).toBe(2);
    expect(columnsForWidth(943, MIN, GAP)).toBe(2);
    expect(columnsForWidth(944, MIN, GAP)).toBe(3);
    expect(columnsForWidth(1266, MIN, GAP)).toBe(4);
    expect(columnsForWidth(1588, MIN, GAP)).toBe(5);
    expect(columnsForWidth(1920, MIN, GAP)).toBe(6);
  });

  it('never returns 0 for the degenerate width < minColumnWidth', () => {
    expect(columnsForWidth(299, MIN, GAP)).toBe(1);
    expect(columnsForWidth(1, MIN, GAP)).toBe(1);
    // The pre-measurement state: a grid that has not been laid out yet reports
    // 0, and must still render one column rather than an empty list.
    expect(columnsForWidth(0, MIN, GAP)).toBe(1);
    expect(columnsForWidth(-500, MIN, GAP)).toBe(1);
  });

  it('handles a zero gap as plain division', () => {
    expect(columnsForWidth(900, 300, 0)).toBe(3);
    expect(columnsForWidth(899, 300, 0)).toBe(2);
    expect(columnsForWidth(1200, 300, 0)).toBe(4);
  });

  it('widens as the gap shrinks and narrows as it grows, at a fixed width', () => {
    expect(columnsForWidth(1000, 300, 0)).toBe(3);
    expect(columnsForWidth(1000, 300, 22)).toBe(3);
    expect(columnsForWidth(1000, 300, 60)).toBe(2);
    expect(columnsForWidth(1000, 300, 400)).toBe(2);
    expect(columnsForWidth(1000, 300, 800)).toBe(1);
    // A negative gap is clamped to 0, never used to invent extra columns.
    expect(columnsForWidth(1000, 300, -100)).toBe(3);
  });

  it('tracks minColumnWidth', () => {
    expect(columnsForWidth(1000, 220, 16)).toBe(4);
    expect(columnsForWidth(1000, 248, 18)).toBe(3);
    expect(columnsForWidth(1000, 1000, 18)).toBe(1);
    expect(columnsForWidth(1000, 1001, 18)).toBe(1);
  });

  it('falls back to a single column on nonsense input rather than NaN', () => {
    expect(columnsForWidth(Number.NaN, MIN, GAP)).toBe(1);
    expect(columnsForWidth(Number.POSITIVE_INFINITY, MIN, GAP)).toBe(1);
    expect(columnsForWidth(1000, Number.NaN, GAP)).toBe(1);
    expect(columnsForWidth(1000, MIN, Number.NaN)).toBe(1);
    expect(columnsForWidth(1000, 0, GAP)).toBe(1);
    expect(columnsForWidth(1000, -300, GAP)).toBe(1);
  });

  it('returns whole numbers for fractional device-pixel widths', () => {
    const n = columnsForWidth(1279.5, MIN, GAP);
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBe(4);
  });
});
