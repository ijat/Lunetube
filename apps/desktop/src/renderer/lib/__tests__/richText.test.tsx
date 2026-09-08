import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextTimestamp } from '@lunetube/shared';
import { renderRichText } from '../richText.js';

/**
 * `renderRichText` is the renderer's single third-party-text → JSX path (shared
 * by comment bodies, the video description and the channel About tab). The two
 * security-relevant properties pinned here: a URL only ever becomes a `<button>`
 * when it is `https:` (F7 — an `http://` URL stays plain text, because
 * `app:openExternal` would reject it), and the button's visible label is exactly
 * the string handed to `app:openExternal`, so display and target cannot diverge.
 * There is no HTML sink — everything is escaped JSX children.
 */

let container: HTMLDivElement;
let root: Root;
const invoke = vi.fn().mockResolvedValue({ ok: true });

beforeEach(() => {
  invoke.mockClear();
  (window as unknown as { lune: unknown }).lune = { invoke };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as unknown as { lune?: unknown }).lune;
});

function render(text: string, timestamps: readonly TextTimestamp[], onSeek?: (s: number) => void) {
  act(() => {
    root.render(
      renderRichText(text, timestamps, {
        ...(onSeek ? { onSeek } : {}),
        timestampClassName: 'ts',
        linkClassName: 'link',
      }),
    );
  });
}

const ts = (index: number, length: number, seconds: number): TextTimestamp => ({
  index,
  length,
  seconds,
});

describe('renderRichText', () => {
  it('passes plain text through unchanged, with no interactive nodes', () => {
    render('just a normal comment, nothing to see', []);
    expect(container.textContent).toBe('just a normal comment, nothing to see');
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });

  it('turns a timestamp into a seek button wired to onSeek(seconds)', () => {
    const onSeek = vi.fn();
    // "skip to 1:23 for the drop" — the timestamp starts at index 8, length 4.
    render('skip to 1:23 for the drop', [ts(8, 4, 83)], onSeek);
    const btn = container.querySelector('button.ts');
    expect(btn?.textContent).toBe('1:23');
    act(() => {
      (btn as HTMLButtonElement).click();
    });
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(83);
  });

  it('renders a timestamp as an inert span (no button) when no onSeek is given', () => {
    render('chapter at 2:00 here', [ts(11, 4, 120)]);
    expect(container.querySelector('button')).toBeNull();
    const span = container.querySelector('span.ts');
    expect(span?.textContent).toBe('2:00');
  });

  it('turns an https:// URL into a button whose label is exactly the openExternal target', () => {
    render('see https://example.com/watch?v=x for more', []);
    const btn = container.querySelector('button.link') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toBe('https://example.com/watch?v=x');
    act(() => {
      btn?.click();
    });
    expect(invoke).toHaveBeenCalledExactlyOnceWith('app:openExternal', {
      url: 'https://example.com/watch?v=x',
    });
    // label rendered === target opened
    expect(btn?.textContent).toBe('https://example.com/watch?v=x');
  });

  it('leaves an http:// URL as plain text — not a button (F7)', () => {
    render('old link http://example.com/x still here', []);
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe('old link http://example.com/x still here');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not turn a timestamp span with undefined seconds into a URL button (latent bug the extraction fixed)', () => {
    // `TextTimestamp.seconds` is required by the type, but a malformed upstream
    // node could carry `undefined`; before the extraction this fell through to
    // the URL branch and rendered a button wired to openExternal(<the timestamp
    // text>). It must render as plain text.
    const bad = { index: 0, length: 4, seconds: undefined } as unknown as TextTimestamp;
    render('1:23 intro', [bad], vi.fn());
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toBe('1:23 intro');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('has no HTML sink — markup in the source string is escaped, not parsed', () => {
    render('<img src=x onerror=alert(1)> <b>bold?</b>', []);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toBe('<img src=x onerror=alert(1)> <b>bold?</b>');
  });
});
