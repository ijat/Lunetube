import { type FormEvent } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Search, Settings2, User } from 'lucide-react';
import { bridge } from '../bridge.js';
import { useUiStore } from '../stores/uiStore.js';

/**
 * One merged 44px frameless bar (decision A2 — supersedes PRD §5.1's 32px bar and
 * the mockup's two-bar direction-B rendering). The bar is the drag region;
 * interactive children opt out with `.no-drag`.
 */
const NAV = [
  { to: '/', label: 'Home' },
  { to: '/library?tab=following', label: 'Following' },
  { to: '/library?tab=history', label: 'History' },
  { to: '/library?tab=playlists', label: 'Playlists' },
];

export function TopBar() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const query = useUiStore((s) => s.searchQuery);
  const setQuery = useUiStore((s) => s.setSearchQuery);

  // Active state must account for the query string — Following / History /
  // Playlists all live at `/library` and differ only by `?tab=` (F7).
  const isNavActive = (to: string): boolean => {
    const target = new URL(to, 'app://x');
    return pathname === target.pathname && (target.search === '' || search === target.search);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <header className="topbar">
      <div className="topbar__zone topbar__zone--left">
        {bridge().platform === 'darwin' && <div className="topbar__traffic" aria-hidden="true" />}
        <NavLink to="/" className="topbar__wordmark no-drag" end>
          Lune<span>Tube</span>
        </NavLink>
      </div>

      <form className="topbar__search no-drag" onSubmit={onSubmit} role="search">
        <Search size={16} strokeWidth={1.8} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search YouTube"
          aria-label="Search YouTube"
        />
      </form>

      <div className="topbar__zone topbar__zone--right">
        <nav className="topbar__nav no-drag">
          {NAV.map((item) => {
            const active = isNavActive(item.to);
            return (
              <Link
                key={item.label}
                to={item.to}
                className={active ? 'is-active' : undefined}
                aria-current={active ? 'page' : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="topbar__right no-drag">
          <NavLink to="/settings" className="topbar__icon" aria-label="Settings">
            <Settings2 size={18} strokeWidth={1.8} />
          </NavLink>
          <span className="topbar__avatar" aria-hidden="true">
            <User size={16} strokeWidth={1.8} />
          </span>
        </div>
      </div>
    </header>
  );
}
