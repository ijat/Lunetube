import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../stores/uiStore.js';
import { TopBar } from './TopBar.js';

// Minimal preload bridge stub — TopBar reads `bridge().platform` during render.
beforeEach(() => {
  (window as unknown as { lune: unknown }).lune = {
    platform: 'linux',
    invoke: async () => ({ ok: true, value: undefined }),
    on: () => () => {},
  };
});

let container: HTMLDivElement;
let root: Root;

function render(path: string): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // TopBar now mounts `SearchSuggestions` (`useSearchSuggestions`) and reads
  // `useQueryClient()` itself for the paste-a-URL flow (plan P2-8) — both need
  // a `QueryClientProvider` in scope, unlike the pre-P2-8 TopBar.
  const queryClient = new QueryClient();
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <TopBar />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useUiStore.setState({ searchQuery: '' });
});

const activeLabels = () =>
  [...container.querySelectorAll('.topbar__nav a.is-active')].map((a) => a.textContent);

describe('TopBar nav active state (F7)', () => {
  it('marks only Following on /library?tab=following', () => {
    render('/library?tab=following');
    expect(activeLabels()).toEqual(['Following']);
  });

  it('marks only History on /library?tab=history', () => {
    render('/library?tab=history');
    expect(activeLabels()).toEqual(['History']);
  });

  it('marks only Home on /', () => {
    render('/');
    expect(activeLabels()).toEqual(['Home']);
  });

  it('marks nothing on an unrelated route', () => {
    render('/watch/abc');
    expect(activeLabels()).toEqual([]);
  });

  it('does not mark Home active while on a library tab', () => {
    render('/library?tab=playlists');
    expect(activeLabels()).toEqual(['Playlists']);
  });
});

// --- Paste-a-URL: unrecognised / non-YouTube links must not be egressed as a
// verbatim search (security S5 + S6) ------------------------------------------

const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype,
  'value',
)?.set;

let currentPath = '';

function LocationSink() {
  const loc = useLocation();
  currentPath = loc.pathname + loc.search;
  return null;
}

/** Renders TopBar with a stubbed `yt:resolveUrl` reply and a location observer. */
function renderWithResolver(resolve: (url: string) => unknown): HTMLInputElement {
  (window as unknown as { lune: unknown }).lune = {
    platform: 'linux',
    on: () => () => {},
    invoke: async (channel: string, payload: { url?: string }) => {
      if (channel === 'yt:resolveUrl') return { ok: true, value: resolve(payload.url ?? '') };
      return { ok: true, value: undefined };
    },
  };
  currentPath = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/']}>
          <TopBar />
          <LocationSink />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  const input = container.querySelector('#topbar-search') as HTMLInputElement | null;
  if (!input) throw new Error('search input not rendered');
  return input;
}

async function submitQuery(input: HTMLInputElement, text: string): Promise<void> {
  await act(async () => {
    nativeInputValueSetter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    input.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    // let the async resolveUrl fetchQuery settle
    await new Promise((r) => setTimeout(r, 0));
  });
}

const hint = () => container.querySelector('.topbar__hint');

describe('TopBar paste-a-URL (S5/S6)', () => {
  it('shows the inline note and does NOT navigate for a non-YouTube link ({kind:"unknown"})', async () => {
    const input = renderWithResolver(() => ({ kind: 'unknown' }));
    await submitQuery(input, 'https://intranet.corp/report?token=secret');
    expect(hint()).not.toBeNull();
    expect(hint()?.textContent).toContain('YouTube link');
    expect(currentPath).toBe('/'); // never routed to /search
  });

  it('shows the inline note for a scheme-less URL the resolver echoes back verbatim (S6)', async () => {
    // `map/url.ts` classifies `192.168.1.1/setup?pw=…` as
    // `{kind:'search', query:<the whole raw string>}` — searching for it would
    // egress the path + query to Google.
    const raw = '192.168.1.1/setup?pw=hunter2';
    const input = renderWithResolver((url) => ({ kind: 'search', query: url }));
    await submitQuery(input, raw);
    expect(hint()).not.toBeNull();
    expect(currentPath).toBe('/');
  });

  it('still routes a genuine youtube.com/results search link to /search', async () => {
    const input = renderWithResolver(() => ({ kind: 'search', query: 'lofi' }));
    await submitQuery(input, 'https://www.youtube.com/results?search_query=lofi');
    expect(hint()).toBeNull();
    expect(currentPath).toBe('/search?q=lofi');
  });
});
