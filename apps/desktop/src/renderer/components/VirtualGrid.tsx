/**
 * A responsive, virtualized grid that scrolls inside the app's ONE scroller
 * (`.stage__content`, P2-F11) instead of nesting a scrollbox of its own.
 *
 * **There is deliberately no jsdom test for the virtualizer.** jsdom has no
 * layout engine — every element reports `clientWidth === 0`, `offsetHeight === 0`
 * and there is no `ResizeObserver` — so a jsdom "virtualization test" would
 * assert that a grid of zero-height rows renders zero rows, which is vacuous and
 * would pass just as happily against a broken implementation. The two things
 * that *can* be tested off-DOM are tested: `columnsForWidth`
 * (`__tests__/layout.test.ts`) and the cards themselves
 * (`__tests__/VideoCard.test.tsx`). Real virtualization coverage is Playwright
 * in P2-11, against a real Chromium. Please do not add a jsdom one here.
 *
 * ## Invariants
 *
 * 1. **Never create a second scroller.** The grid is a plain block; scrolling is
 *    the shell's. `useScrollContainer()` is the only source of the scroll
 *    element.
 * 2. **`scrollMargin` is the sizer's live offset from the top of the scroller's
 *    content**, not a value captured once at mount. `@tanstack/virtual-core`
 *    lays items out at `paddingStart + scrollMargin …`, and `getTotalSize()`
 *    subtracts it back out — so the container is `height: getTotalSize()` and a
 *    row sits at `translateY(item.start - scrollMargin)`. If `scrollMargin` goes
 *    stale (the filter bar above the grid rewraps, a banner image loads), the
 *    virtualizer mounts the wrong window of rows. See `useVirtualAnchor` for the
 *    triggers that keep it live and for what the failure actually looks like.
 * 3. **A column-count change invalidates every measured row height.** Row `n`
 *    holds different cards at 3 columns than at 4, and a 16:9 thumbnail's height
 *    is a function of the column width, so the cached sizes are meaningless
 *    across the change — including for the ~80 rows that are *not* mounted and
 *    therefore have no `ResizeObserver` to correct them. `virtualizer.measure()`
 *    clears the whole cache so every unmounted row falls back to the estimate
 *    instead of to a measurement taken at a different column count.
 * 4. **`aria-setsize` / `aria-posinset` carry the real totals**, not the ~20
 *    mounted rows, so a screen reader is told the truth about the collection.
 */
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useScrollContainer, type GetScrollElement } from '../shell/ScrollContainer.js';
import { columnsForWidth } from './layout.js';
import './virtual.css';

/** `CSSProperties` plus CSS custom properties, which React's own type omits. */
export type StyleWithVars = CSSProperties & Record<`--${string}`, string | number>;

export interface VirtualAnchor {
  /** Content width of the sizer element, in CSS px. `0` until measured. */
  width: number;
  /** Sizer offset from the top of the scroller's content, in CSS px. */
  scrollMargin: number;
  /** The shell scroller getter, ready to hand to `useVirtualizer`. */
  getScrollElement: GetScrollElement;
}

/**
 * Keeps `{ width, scrollMargin }` for `sizerRef` in sync with reality.
 *
 * Shared by `VirtualGrid` and `VirtualList` on purpose: the `scrollMargin` rule
 * is the single subtlest thing about driving a virtualizer off a scroller you do
 * not own, and two copies of it would drift.
 *
 * Remeasure triggers:
 *  - **every commit** (`useLayoutEffect` with no dep array). This is the
 *    workhorse, and it covers more than it looks like it does: the virtualizer
 *    re-renders on every scroll burst (`isScrolling` toggles true then false),
 *    so "content above the grid reflowed with no React render at all" — a banner
 *    image loading in — is corrected on the user's very next scroll frame. That
 *    was verified against a real Chromium by growing an element above the grid
 *    purely in the DOM and then scrolling; an explicit `scroll` listener was
 *    tried, made no difference to the outcome, and was dropped as dead weight.
 *    (It would start mattering if this ever ran with `directDomUpdates: true`,
 *    which skips React on scroll-only updates. It does not.)
 *  - **`ResizeObserver` on the sizer** — width changes (window resize, dock
 *    appearing) that drive the column count;
 *  - **`ResizeObserver` on the scroller** — the viewport itself changing size,
 *    which moves content above the grid without resizing the grid.
 *
 * Values are rounded to whole px so sub-pixel jitter cannot drive a render loop.
 *
 * The failure mode this defends against is worth naming precisely, because it is
 * NOT what it looks like: rows are absolutely positioned *inside the sizer*, so
 * a stale `scrollMargin` does not displace them — the sizer moves and they move
 * with it. What goes wrong is that the virtualizer computes the visible range
 * from the wrong origin and mounts the wrong window of rows, which the user sees
 * as a blank band. A freeze-scrollMargin-after-mount mutation reproduced exactly
 * that: an 800px empty strip at the top of the viewport.
 */
export function useVirtualAnchor(
  sizerRef: RefObject<HTMLElement | null>,
  anchorRef?: RefObject<HTMLElement | null>,
): VirtualAnchor {
  const getScrollElement = useScrollContainer();
  const [metrics, setMetrics] = useState({ width: 0, scrollMargin: 0 });

  const measure = useCallback(() => {
    const sizer = sizerRef.current;
    if (!sizer) return;
    const scroller = getScrollElement();
    const anchor = anchorRef?.current ?? sizer;

    const width = Math.round(sizer.clientWidth);
    // `clientTop` is the scroller's top border: `scrollTop` is measured from the
    // padding edge, `getBoundingClientRect()` from the border edge.
    const scrollMargin = scroller
      ? Math.round(
          anchor.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top -
            scroller.clientTop +
            scroller.scrollTop,
        )
      : 0;

    setMetrics((prev) =>
      prev.width === width && prev.scrollMargin === scrollMargin ? prev : { width, scrollMargin },
    );
  }, [sizerRef, anchorRef, getScrollElement]);

  // Every commit. Terminates: a measure that finds no change returns the
  // previous state object, so React bails out and no further render is queued.
  useLayoutEffect(() => {
    measure();
  });

  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const sizer = sizerRef.current;
    const scroller = getScrollElement();
    const observer = new ResizeObserver(() => measure());
    if (sizer) observer.observe(sizer);
    if (scroller) observer.observe(scroller);
    return () => observer.disconnect();
  }, [sizerRef, getScrollElement, measure]);

  return { width: metrics.width, scrollMargin: metrics.scrollMargin, getScrollElement };
}

export interface VirtualGridProps<T> {
  items: readonly T[];
  renderItem: (item: T, index: number) => ReactNode;
  /** Narrowest a column may get before the grid drops to fewer columns. */
  minColumnWidth: number;
  /** Horizontal gutter between columns, in px. */
  gapX: number;
  /** Vertical gutter between rows, in px. */
  gapY: number;
  /**
   * First guess at a row's content height (excluding `gapY`), used until the row
   * is really measured. Only affects scrollbar accuracy ahead of the viewport.
   */
  estimateRowHeight: number;
  /** Rows rendered beyond each edge of the viewport. Defaults to 4. */
  overscan?: number;
  /**
   * Element whose top edge marks the start of the virtualized content.
   * Defaults to the grid's own sizer, which is almost always what you want.
   *
   * It **must share the sizer's top edge**: rows are absolutely positioned
   * inside the sizer, and the sizer reserves exactly `getTotalSize()` px
   * starting at its own top, so an anchor higher up the page would shift the
   * virtualizer's idea of where the content begins without moving the space
   * that was reserved for it.
   */
  scrollMarginRef?: RefObject<HTMLElement | null>;
  /** Accessible name for the `role="list"` container. */
  ariaLabel: string;
}

export function VirtualGrid<T>({
  items,
  renderItem,
  minColumnWidth,
  gapX,
  gapY,
  estimateRowHeight,
  overscan = 4,
  scrollMarginRef,
  ariaLabel,
}: VirtualGridProps<T>) {
  const sizerRef = useRef<HTMLDivElement | null>(null);
  const { width, scrollMargin, getScrollElement } = useVirtualAnchor(sizerRef, scrollMarginRef);

  const columns = columnsForWidth(width, minColumnWidth, gapX);
  const rowCount = Math.ceil(items.length / columns);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement,
    estimateSize: () => estimateRowHeight + gapY,
    overscan,
    scrollMargin,
  });

  // Invariant 3: the measured heights of a 3-column layout say nothing about a
  // 4-column one.
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [virtualizer, columns]);

  const style: StyleWithVars = {
    height: `${virtualizer.getTotalSize()}px`,
    '--vgrid-cols': columns,
    '--vgrid-gap-x': `${gapX}px`,
    '--vgrid-gap-y': `${gapY}px`,
  };

  return (
    <div ref={sizerRef} className="vgrid" role="list" aria-label={ariaLabel} style={style}>
      {virtualizer.getVirtualItems().map((row) => {
        const first = row.index * columns;
        return (
          <div
            // Deliberately NOT keyed on `columns`. Doing so would remount every
            // mounted row on each reflow, which measures a frame sooner but
            // destroys keyboard focus inside a card whenever the window is
            // resized, and re-creates every `<img>`. `virtualizer.measure()`
            // above plus each row's own `ResizeObserver` (registered by
            // `measureElement`) already re-measure the mounted rows.
            key={row.key}
            className="vgrid__row"
            data-index={row.index}
            ref={virtualizer.measureElement}
            role="presentation"
            style={{ transform: `translateY(${row.start - scrollMargin}px)` }}
          >
            {items.slice(first, first + columns).map((item, offset) => (
              <div
                key={first + offset}
                className="vgrid__cell"
                role="listitem"
                aria-setsize={items.length}
                aria-posinset={first + offset + 1}
              >
                {renderItem(item, first + offset)}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
