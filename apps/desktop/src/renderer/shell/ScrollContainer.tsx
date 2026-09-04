import { createContext, useContext, useMemo, type ReactNode } from 'react';

/**
 * The app has exactly ONE scroller: `.stage__content`, the `<main>` rendered by
 * `AppFrame` (`renderer/styles/global.css` — `overflow-y: auto`). Plan finding
 * P2-F11: every virtualizer must attach to *that* element with an explicit
 * `scrollMargin`, never wrap itself in a nested scrollbox — a nested one breaks
 * the Direction-B full-bleed feel and puts two scrollbars on the watch page.
 *
 * This context is how a route-level component reaches it without prop-drilling
 * through the router.
 *
 * **Why the element travels as React state and not as a bare ref.** React
 * attaches host refs during the layout phase, bottom-up: a descendant's
 * `useLayoutEffect` can run *before* the ancestor `<main>`'s ref is populated.
 * `@tanstack/react-virtual` reads `getScrollElement()` in `_willUpdate()`, which
 * it runs in a layout effect on every render — so a `null` on the first pass is
 * recoverable *only if another render follows*. Publishing the element through
 * `useState` in `AppFrame` guarantees that render: when the element attaches,
 * the getter's identity changes, consumers re-render, and the virtualizer binds
 * on its next `_willUpdate()`. A bare ref would silently leave a virtualizer
 * unbound (rendering nothing, forever) whenever the ordering went the other way.
 */
export type GetScrollElement = () => HTMLElement | null;

const NO_SCROLL_ELEMENT: GetScrollElement = () => null;

const ScrollContainerContext = createContext<GetScrollElement>(NO_SCROLL_ELEMENT);

export interface ScrollContainerProviderProps {
  /** The scroll element, or `null` before it has attached. */
  element: HTMLElement | null;
  children: ReactNode;
}

export function ScrollContainerProvider({ element, children }: ScrollContainerProviderProps) {
  // Identity is keyed to the element so a consumer effect that depends on the
  // getter re-runs exactly when the scroller appears or is swapped out.
  const getScrollElement = useMemo<GetScrollElement>(() => () => element, [element]);
  return (
    <ScrollContainerContext.Provider value={getScrollElement}>
      {children}
    </ScrollContainerContext.Provider>
  );
}

/**
 * `() => HTMLElement | null` for the app's single scroller. Returns a getter
 * that always yields `null` when used outside `AppFrame` (unit tests, Storybook-
 * like harnesses); a virtualizer given a null scroller renders nothing rather
 * than throwing.
 */
export function useScrollContainer(): GetScrollElement {
  return useContext(ScrollContainerContext);
}
