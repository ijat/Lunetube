import { useCallback, useState, type FormEvent } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Search, Settings2, User } from 'lucide-react';
import { bridge } from '../bridge.js';
import { resolveUrlOnce } from '../lib/queries.js';
import { useUiStore } from '../stores/uiStore.js';
import { SearchSuggestions } from './SearchSuggestions.js';

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

/**
 * A rough "does this look like a URL" gate (plan P2-8 "Paste-a-URL"). The real
 * classification — including the host allow-list — lives server-side in
 * `yt:resolveUrl` (`packages/youtube/src/innertube/map/url.ts`); this only
 * decides whether the IPC round trip is worth attempting at all, so an
 * ordinary search phrase never pays for it.
 */
function looksLikeUrl(text: string): boolean {
  if (/^[a-z][\w+.-]*:\/\//i.test(text)) return true; // explicit scheme
  const host = text.split(/[/?#]/)[0] ?? '';
  return /^[\w-]+(\.[\w-]+)+$/.test(host); // bare "domain.tld/…", no scheme
}

export function TopBar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pathname, search } = useLocation();
  const query = useUiStore((s) => s.searchQuery);
  const setStoreQuery = useUiStore((s) => s.setSearchQuery);
  // Shown when a pasted string parsed as a URL but is not a recognised YouTube
  // link — we deliberately do NOT fall through to a verbatim YouTube search,
  // which would egress the whole URL (path + query) to Google (security S5).
  const [notALink, setNotALink] = useState(false);

  const setQuery = useCallback(
    (next: string) => {
      setNotALink(false);
      setStoreQuery(next);
    },
    [setStoreQuery],
  );

  // Active state must account for the query string — Following / History /
  // Playlists all live at `/library` and differ only by `?tab=` (F7).
  const isNavActive = (to: string): boolean => {
    const target = new URL(to, 'app://x');
    return pathname === target.pathname && (target.search === '' || search === target.search);
  };

  const goToSearch = (q: string) => navigate(`/search?q=${encodeURIComponent(q)}`);

  /**
   * `resolveUrlOnce` per plan P2-8 — a pasted YouTube URL/share-link jumps
   * straight to its target. `parseYouTubeUrl` can still classify a URL-shaped
   * string as `{kind:'search'}` (a `youtube.com/results?search_query=` link, or
   * a bare phrase), which we honour. But a string that parsed as a URL and came
   * back `{kind:'unknown'}` is a non-YouTube link: we surface an inline note and
   * stop, rather than sending the whole URL to a YouTube search (security S5).
   */
  const resolveAndNavigate = async (raw: string): Promise<void> => {
    try {
      const target = await resolveUrlOnce(queryClient, raw);
      switch (target.kind) {
        case 'video':
          navigate(
            `/watch/${encodeURIComponent(target.videoId)}${
              target.startSec !== undefined ? `?t=${target.startSec}` : ''
            }`,
          );
          return;
        case 'channel':
          navigate(`/channel/${encodeURIComponent(target.channelId)}`);
          return;
        case 'playlist':
          navigate(`/playlist/${encodeURIComponent(target.playlistId)}`);
          return;
        case 'search':
          goToSearch(target.query);
          return;
        case 'unknown':
          setNotALink(true);
          return;
      }
    } catch {
      // Resolution failed (network/parse) — treat a URL-shaped input as
      // unrecognised rather than searching for it verbatim.
      setNotALink(true);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setNotALink(false);
    const q = query.trim();
    if (!q) return;
    if (looksLikeUrl(q)) {
      void resolveAndNavigate(q);
      return;
    }
    goToSearch(q);
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
        <SearchSuggestions
          id="topbar-search"
          value={query}
          onChange={setQuery}
          onCommit={goToSearch}
          placeholder="Search YouTube"
          ariaLabel="Search YouTube"
        />
        {notALink && (
          <p className="topbar__hint" role="alert">
            That doesn&rsquo;t look like a YouTube link.
          </p>
        )}
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
