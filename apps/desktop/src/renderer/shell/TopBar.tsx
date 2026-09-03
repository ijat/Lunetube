import { type FormEvent } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Search, Settings2, User } from 'lucide-react';
import { useUiStore } from '../stores/uiStore.js';

/**
 * One merged 44px frameless bar (decision A2 — supersedes PRD §5.1's 32px bar and
 * the mockup's two-bar direction-B rendering). The bar is the drag region;
 * interactive children opt out with `.no-drag`.
 */
const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/library?tab=following', label: 'Following' },
  { to: '/library?tab=history', label: 'History' },
  { to: '/library?tab=playlists', label: 'Playlists' },
];

export function TopBar() {
  const navigate = useNavigate();
  const query = useUiStore((s) => s.searchQuery);
  const setQuery = useUiStore((s) => s.setSearchQuery);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <header className="topbar">
      {window.lune.platform === 'darwin' && <div className="topbar__traffic" aria-hidden="true" />}

      <NavLink to="/" className="topbar__wordmark no-drag" end>
        Lune<span>Tube</span>
      </NavLink>

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

      <nav className="topbar__nav no-drag">
        {NAV.map((item) => (
          <NavLink
            key={item.label}
            to={item.to}
            end={item.end ?? false}
            className={({ isActive }) => (isActive ? 'is-active' : undefined)}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="topbar__right no-drag">
        <NavLink to="/settings" className="topbar__icon" aria-label="Settings">
          <Settings2 size={18} strokeWidth={1.8} />
        </NavLink>
        <span className="topbar__avatar" aria-hidden="true">
          <User size={16} strokeWidth={1.8} />
        </span>
      </div>
    </header>
  );
}
