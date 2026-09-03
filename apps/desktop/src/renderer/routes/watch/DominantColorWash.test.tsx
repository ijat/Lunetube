import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DominantColorWash } from './DominantColorWash.js';

// A deterministic stand-in for node-vibrant: the palette is derived from the
// image src, so two different thumbnails yield two different washes.
vi.mock('node-vibrant/browser', () => ({
  Vibrant: {
    from: (src: string) => ({
      getPalette: async () => {
        let h = 2166136261;
        for (let i = 0; i < src.length; i++) h = (h ^ src.charCodeAt(i)) * 16777619;
        const chan = (n: number): [number, number, number] => [
          (h + n) & 255,
          (h >> 8) & 255,
          (h >> 16) & 255,
        ];
        return {
          DarkVibrant: { rgb: chan(0) },
          DarkMuted: { rgb: chan(30) },
          Vibrant: { rgb: chan(60) },
          Muted: null,
          LightVibrant: null,
          LightMuted: null,
        };
      },
    }),
  },
}));

let container: HTMLDivElement;
let root: Root;
let mounted = false;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = true;
});

function unmount(): void {
  if (!mounted) return;
  mounted = false;
  act(() => root.unmount());
}

afterEach(() => {
  unmount();
  container.remove();
  for (const v of ['--wash-a', '--wash-b', '--glow']) {
    document.documentElement.style.removeProperty(v);
  }
});

const washA = () => document.documentElement.style.getPropertyValue('--wash-a');

async function render(videoId: string, thumbnailUrl: string | null): Promise<void> {
  await act(async () => {
    root.render(<DominantColorWash videoId={videoId} thumbnailUrl={thumbnailUrl} />);
  });
  // flush the getPalette() microtask chain
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('DominantColorWash', () => {
  it('writes --wash-a/-b and --glow from a proxied thumbnail', async () => {
    await render('vid-a', 'http://127.0.0.1:5599/tok/img?u=A');
    expect(washA()).toMatch(/^rgb\(\d+ \d+ \d+ \/ 0\.24\)$/);
    expect(document.documentElement.style.getPropertyValue('--wash-b')).not.toBe('');
    expect(document.documentElement.style.getPropertyValue('--glow')).not.toBe('');
  });

  it('changes the wash when the video id + thumbnail change', async () => {
    await render('vid-a', 'http://127.0.0.1:5599/tok/img?u=A');
    const first = washA();
    await render('vid-b', 'http://127.0.0.1:5599/tok/img?u=B');
    const second = washA();
    expect(first).not.toBe('');
    expect(second).not.toBe('');
    expect(second).not.toBe(first);
  });

  it('does not touch the washes for a non-proxied (upstream https) thumbnail', async () => {
    await render('vid-a', 'https://i.ytimg.com/vi/vid-a/maxresdefault.jpg');
    expect(washA()).toBe('');
  });

  it('clears the washes on unmount', async () => {
    await render('vid-a', 'http://127.0.0.1:5599/tok/img?u=A');
    expect(washA()).not.toBe('');
    unmount();
    expect(washA()).toBe('');
  });
});
