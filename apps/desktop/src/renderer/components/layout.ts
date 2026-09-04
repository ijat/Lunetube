/**
 * Pure layout maths for the virtualized grid.
 *
 * It lives on its own, free of React and the DOM, because jsdom has no layout
 * engine: every element reports zero width, so the only way to pin the
 * responsive-column behaviour with a unit test is to test the arithmetic
 * directly (`__tests__/layout.test.ts`). The rendered behaviour is covered in
 * Playwright (P2-11), where a real Chromium actually lays out.
 */

/**
 * How many equal columns of at least `minColumnWidth` fit into `width` when
 * consecutive columns are separated by `gapX`.
 *
 * `n` columns occupy `n * minColumnWidth + (n - 1) * gapX`, so
 * `n * minColumnWidth + (n - 1) * gapX <= width`
 * ⟺ `n * (minColumnWidth + gapX) <= width + gapX`
 * ⟺ `n <= (width + gapX) / (minColumnWidth + gapX)`.
 *
 * Always at least 1: a viewport narrower than one column still shows one
 * (squeezed) column rather than nothing at all. A not-yet-measured grid reports
 * `width === 0` and lands on that same floor, so the first paint is a single
 * column that widens on the next frame — never an empty grid.
 */
export function columnsForWidth(width: number, minColumnWidth: number, gapX: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(minColumnWidth) || !Number.isFinite(gapX)) {
    return 1;
  }
  if (minColumnWidth <= 0) return 1;
  const gap = Math.max(0, gapX);
  return Math.max(1, Math.floor((width + gap) / (minColumnWidth + gap)));
}
