/**
 * A vertical, variable-height virtualized list over the app's ONE scroller
 * (`.stage__content`, P2-F11) — the same rule and the same `useVirtualAnchor`
 * machinery as `VirtualGrid`, so the two can never drift on `scrollMargin`.
 *
 * Heights are measured, not estimated: every row carries `data-index` and the
 * virtualizer's `measureElement` ref, so a two-line comment and a twenty-line
 * one both land in the right place. `estimateItemHeight` only sets the
 * scrollbar's guess for rows that have not been on screen yet.
 *
 * As with `VirtualGrid`, **there is no jsdom test for the virtualization**:
 * jsdom reports zero element sizes and has no `ResizeObserver`, so such a test
 * would be vacuous. Coverage is Playwright (P2-11).
 */
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useVirtualAnchor } from './VirtualGrid.js';
import './virtual.css';

export interface VirtualListProps<T> {
  /** Already flattened — a caller that expands rows in place owns the flattening. */
  items: readonly T[];
  renderItem: (item: T, index: number) => ReactNode;
  /** First guess at a row's height (excluding `gap`), in px. */
  estimateItemHeight: number;
  /** Vertical gutter between rows, in px. Defaults to 0. */
  gap?: number;
  /** Rows rendered beyond each edge of the viewport. Defaults to 4. */
  overscan?: number;
  /**
   * Stable identity per row, so the measurement cache survives a splice
   * (inserting replies into the middle of a comment list must not resize every
   * row after it). Index-based by default. **Memoize it** — the virtualizer
   * recomputes its measurement layout whenever this function's identity changes.
   */
  getItemKey?: (index: number) => string | number;
  /** See `VirtualGridProps.scrollMarginRef`; must share the sizer's top edge. */
  scrollMarginRef?: RefObject<HTMLElement | null>;
  /** Accessible name for the `role="list"` container. */
  ariaLabel: string;
}

export function VirtualList<T>({
  items,
  renderItem,
  estimateItemHeight,
  gap = 0,
  overscan = 4,
  getItemKey,
  scrollMarginRef,
  ariaLabel,
}: VirtualListProps<T>) {
  const sizerRef = useRef<HTMLDivElement | null>(null);
  const { scrollMargin, getScrollElement } = useVirtualAnchor(sizerRef, scrollMarginRef);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement,
    estimateSize: () => estimateItemHeight + gap,
    overscan,
    scrollMargin,
    // `exactOptionalPropertyTypes` forbids handing the option an explicit
    // `undefined`, so it is spread in only when supplied.
    ...(getItemKey ? { getItemKey } : {}),
  });

  // A gap change rescales every row, and gap is folded into the measured size.
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [virtualizer, gap]);

  return (
    <div
      ref={sizerRef}
      className="vlist"
      role="list"
      aria-label={ariaLabel}
      style={{ height: `${virtualizer.getTotalSize()}px` }}
    >
      {virtualizer.getVirtualItems().map((row) => {
        const item = items[row.index];
        if (item === undefined) return null;
        return (
          <div
            key={row.key}
            className="vlist__item"
            data-index={row.index}
            ref={virtualizer.measureElement}
            role="listitem"
            aria-setsize={items.length}
            aria-posinset={row.index + 1}
            style={{ transform: `translateY(${row.start - scrollMargin}px)`, paddingBottom: gap }}
          >
            {renderItem(item, row.index)}
          </div>
        );
      })}
    </div>
  );
}
