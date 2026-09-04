import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
