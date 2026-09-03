import { type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Backdrop } from './Backdrop.js';
import { Grain } from './Grain.js';
import { TopBar } from './TopBar.js';
import { Dock } from './Dock.js';

/**
 * Direction B "Cinema" shell: no rail, one floating top bar, edge-to-edge
 * content, living backdrop + grain, bottom now-playing dock on watch routes.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const onWatch = useLocation().pathname.startsWith('/watch');

  return (
    <div className="stage" data-dir="b" data-screen={onWatch ? 'watch' : 'browse'}>
      <Backdrop />
      <Grain />
      <TopBar />
      <main className="stage__content" data-watch={onWatch}>
        {children}
      </main>
      {onWatch && <Dock />}
    </div>
  );
}
