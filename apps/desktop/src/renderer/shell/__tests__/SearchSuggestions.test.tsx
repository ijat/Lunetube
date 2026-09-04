import { useState, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchSuggestions } from '../SearchSuggestions.js';

/**
 * Covers plan P2-8's done-criterion for this file: keyboard nav, Esc,
 * click-away, and the silent-failure path (a suggestions query error renders
 * NOTHING — P2-F7 — never an error row).
 *
 * Real timers throughout (no `vi.useFakeTimers`): the 180ms debounce plus
 * react-query's own microtask scheduling is fragile to fake-timer flushing
 * order, and a `waitFor` poll on real timers sidesteps that entirely for the
 * cost of a few hundred real milliseconds per test.
 */

type Bridge = {
  invoke: (channel: string, payload: unknown) => Promise<unknown>;
  on: () => () => void;
};

function setBridge(invoke: Bridge['invoke']): void {
  (window as unknown as { lune: Bridge }).lune = { invoke, on: () => () => {} };
}

const SUGGESTIONS = ['cats', 'cats compilation', 'cats vs cucumbers'];

function suggestionsBridge(
  result: { ok: true; value: string[] } | { ok: false; error: Record<string, unknown> },
): Bridge['invoke'] {
  return async (channel) => {
    if (channel === 'yt:searchSuggestions') return result;
    return { ok: true, value: undefined };
  };
}

let container: HTMLDivElement;
let root: Root;

function Harness({ onCommit }: { onCommit: (v: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <SearchSuggestions
      id="topbar-search"
      value={value}
      onChange={setValue}
      onCommit={onCommit}
      placeholder="Search YouTube"
      ariaLabel="Search YouTube"
    />
  );
}

function render(onCommit: (v: string) => void): HTMLInputElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  const queryClient = new QueryClient();
  root = createRoot(container);
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Harness onCommit={onCommit} />
      </QueryClientProvider>,
    );
  });
  const input = container.querySelector('input');
  if (!input) throw new Error('input not rendered');
  return input;
}

// A plain `input.value = text` goes through React's own tracked instance
// setter on a controlled input, which updates React's internal value tracker
// in the same stroke — so when the native `input` event then fires, React
// sees no difference between the DOM value and its own record and never
// calls `onChange`. Bypassing the instance setter for the prototype's native
// one (the standard fix, same one Testing Library's `fireEvent` applies
// internally) keeps the tracker out of sync so React's change detection fires
// for real.
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype,
  'value',
)?.set;

function typeInto(input: HTMLInputElement, text: string): void {
  act(() => {
    nativeInputValueSetter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function keydown(input: HTMLInputElement, key: string): void {
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}

const listbox = () => container.querySelector('[role="listbox"]');
const options = () => [...container.querySelectorAll('[role="option"]')];

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('SearchSuggestions (P2-8)', () => {
  it('debounces, opens on results, and ArrowDown+Enter commits a highlighted row', async () => {
    setBridge(suggestionsBridge({ ok: true, value: SUGGESTIONS }));
    const onCommit = vi.fn();
    const input = render(onCommit);

    act(() => input.focus());
    typeInto(input, 'ca');
    await waitFor(() => listbox() !== null);
    expect(options()).toHaveLength(3);
    expect(input.getAttribute('aria-expanded')).toBe('true');

    keydown(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe('topbar-search-option-0');
    expect(options()[0]?.getAttribute('aria-selected')).toBe('true');

    keydown(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe('topbar-search-option-1');

    keydown(input, 'Enter');
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('cats compilation');
    expect(input.value).toBe('cats compilation');
    // Committing closes the popup — it must not immediately reopen (the
    // committed value is itself a suggestion match).
    expect(listbox()).toBeNull();
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('a mouse click on a row commits it too', async () => {
    setBridge(suggestionsBridge({ ok: true, value: SUGGESTIONS }));
    const onCommit = vi.fn();
    const input = render(onCommit);

    act(() => input.focus());
    typeInto(input, 'ca');
    await waitFor(() => listbox() !== null);

    const button = options()[2]?.querySelector('button');
    if (!button) throw new Error('option button not found');
    act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(onCommit).toHaveBeenCalledExactlyOnceWith('cats vs cucumbers');
    expect(listbox()).toBeNull();
  });

  it('Escape closes the popup without clearing the input; typing again reopens it', async () => {
    setBridge(suggestionsBridge({ ok: true, value: SUGGESTIONS }));
    const input = render(vi.fn());

    act(() => input.focus());
    typeInto(input, 'ca');
    await waitFor(() => listbox() !== null);

    keydown(input, 'Escape');
    expect(listbox()).toBeNull();
    expect(input.value).toBe('ca'); // Escape does not clear the query.

    typeInto(input, 'cat');
    await waitFor(() => listbox() !== null);
    expect(options().length).toBeGreaterThan(0);
  });

  it('a click outside the combobox closes the popup (click-away)', async () => {
    setBridge(suggestionsBridge({ ok: true, value: SUGGESTIONS }));
    const input = render(vi.fn());

    act(() => input.focus());
    typeInto(input, 'ca');
    await waitFor(() => listbox() !== null);

    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(listbox()).toBeNull();
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('a suggestions query failure renders nothing — no error row, no crash (P2-F7)', async () => {
    setBridge(
      suggestionsBridge({
        ok: false,
        error: { code: 'YT_NETWORK', message: 'network down', retryable: true },
      }),
    );
    const input = render(vi.fn());

    act(() => input.focus());
    typeInto(input, 'ca');
    // Give the debounce + failed fetch time to settle, then assert the
    // negative: no listbox ever appears, and nothing else stands in for it.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    expect(listbox()).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });
});
