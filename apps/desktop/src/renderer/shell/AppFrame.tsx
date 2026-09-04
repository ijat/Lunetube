import { useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Backdrop } from './Backdrop.js';
import { Grain } from './Grain.js';
import { TopBar } from './TopBar.js';
import { Dock } from './Dock.js';
import { ScrollContainerProvider } from './ScrollContainer.js';

/**
 * Direction B "Cinema" shell: no rail, one floating top bar, edge-to-edge
 * content, living backdrop + grain, bottom now-playing dock on watch routes.
 *
 * `.stage__content` is the app's only scroller (P2-F11). It is published through
 * `ScrollContainerProvider` so the virtualizers can attach to it instead of
 * nesting a second scrollbox — see `ScrollContainer.tsx` for why the element
 * travels as state rather than as a ref.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const onWatch = useLocation().pathname.startsWith('/watch');
  const [scroller, setScroller] = useState<HTMLElement | null>(null);

  return (
    <div className="stage" data-dir="b" data-screen={onWatch ? 'watch' : 'browse'}>
      <Backdrop />
      <Grain />
      <TopBar />
      <ScrollContainerProvider element={scroller}>
        <main className="stage__content" ref={setScroller} data-watch={onWatch}>
          {children}
        </main>
      </ScrollContainerProvider>
      {onWatch && <Dock />}
    </div>
  );
}
