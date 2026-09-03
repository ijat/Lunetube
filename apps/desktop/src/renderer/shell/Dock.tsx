import { ListVideo } from 'lucide-react';

/**
 * Bottom now-playing dock placeholder (mockup L495-512). Wired to the queue store
 * in Phase 3; for now it renders only when a `/watch` route is active and shows
 * an explicit placeholder rather than a silent gap.
 */
export function Dock() {
  return (
    <footer className="dock glass-root" aria-label="Now playing">
      <div className="dock__mini" aria-hidden="true" />
      <div className="dock__meta">
        <div className="dock__title">Nothing playing yet</div>
        <div className="dock__sub tnum">Queue and now-playing controls arrive in Phase 3</div>
      </div>
      <div className="dock__upnext">
        <ListVideo size={18} strokeWidth={1.8} aria-hidden="true" />
      </div>
    </footer>
  );
}
