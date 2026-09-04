import { describe, expect, it, vi, beforeEach } from 'vitest';
import { err, ok, type Result } from '@lunetube/shared';

type IpcHandler = (event: unknown, payload: unknown) => unknown;
const handlers = new Map<string, IpcHandler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => handlers.set(channel, handler),
  },
}));

const calls: { method: string; params: unknown }[] = [];
let nextResult: Result<unknown, unknown> = ok({});

const fakeSource = new Proxy(
  {},
  {
    get:
      (_t, method: string) =>
      (...args: unknown[]) => {
        calls.push({ method, params: args[0] });
        return Promise.resolve(nextResult);
      },
  },
);

vi.mock('../services/container.js', () => ({ youtubeSource: () => fakeSource }));

const { registerYoutubeIpc } = await import('./youtube.js');
registerYoutubeIpc();

const invoke = (channel: string, payload: unknown) => handlers.get(channel)!(null, payload);

beforeEach(() => {
  calls.length = 0;
  nextResult = ok({ title: 'ok' });
});

describe('yt:* IPC handlers (P1-4, extended P2-6)', () => {
  it('registers all eleven channels', () => {
    expect([...handlers.keys()].sort()).toEqual([
      'yt:channel',
      'yt:commentReplies',
      'yt:comments',
      'yt:diagnostics',
      'yt:playlist',
      'yt:related',
      'yt:resolveUrl',
      'yt:search',
      'yt:searchSuggestions',
      'yt:streams',
      'yt:video',
    ]);
  });

  it('yt:video forwards { videoId } and unwraps ok', async () => {
    nextResult = ok({ title: 'Costa Rica' });
    await expect(invoke('yt:video', { videoId: 'LXb3EKWsInQ' })).resolves.toEqual({
      ok: true,
      value: { title: 'Costa Rica' },
    });
    expect(calls).toEqual([{ method: 'getVideo', params: { videoId: 'LXb3EKWsInQ' } }]);
  });

  it('yt:video rejects an empty videoId before touching the source', async () => {
    const res = (await invoke('yt:video', { videoId: '  ' })) as {
      ok: false;
      error: { code: string };
    };
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('INVALID_INPUT');
    expect(calls).toEqual([]);
  });

  it('yt:video re-throws a Result error as the LuneError', async () => {
    nextResult = err({ code: 'YT_RATE_LIMITED', message: 'slow down', retryable: true });
    const res = (await invoke('yt:video', { videoId: 'abc123' })) as {
      ok: false;
      error: { code: string; retryable: boolean };
    };
    expect(res.error.code).toBe('YT_RATE_LIMITED');
    expect(res.error.retryable).toBe(true);
  });

  it('yt:streams normalises prefs (bad maxHeight → auto) and requires an object', async () => {
    await invoke('yt:streams', {
      videoId: 'abc123',
      prefs: { maxHeight: 'garbage', preferredAudioLanguage: 5, audioOnly: 'yes' },
    });
    expect(calls[0]).toEqual({
      method: 'getStreams',
      params: {
        videoId: 'abc123',
        prefs: { maxHeight: 'auto', preferredAudioLanguage: null, audioOnly: false },
      },
    });

    const res = (await invoke('yt:streams', { videoId: 'abc123' })) as {
      ok: false;
      error: { code: string };
    };
    expect(res.error.code).toBe('INVALID_INPUT');
  });

  it('yt:related forwards only { videoId } (A13 — single-page, no continuation)', async () => {
    await invoke('yt:related', { videoId: 'abc123', continuation: 'tok' });
    expect(calls[0]!.params).toEqual({ videoId: 'abc123' });
  });

  it('yt:diagnostics forwards with no payload', async () => {
    nextResult = ok({ youtubeiVersion: 'fake' });
    await expect(invoke('yt:diagnostics', {})).resolves.toEqual({
      ok: true,
      value: { youtubeiVersion: 'fake' },
    });
    expect(calls).toEqual([{ method: 'getDiagnostics', params: undefined }]);
  });
});

async function expectInvalidInput(channel: string, payload: unknown): Promise<void> {
  const res = (await invoke(channel, payload)) as { ok: false; error: { code: string } };
  expect(res.ok).toBe(false);
  expect(res.error.code).toBe('INVALID_INPUT');
  expect(calls).toEqual([]);
}

describe('yt:search (P2-6)', () => {
  it('forwards query, coerces filters field-by-field, and forwards continuation', async () => {
    await invoke('yt:search', {
      query: '  cats  ',
      filters: { sort: 'views', uploadDate: 'week', bogusKey: 'x' },
      continuation: 'tok',
    });
    expect(calls[0]).toEqual({
      method: 'search',
      params: {
        query: 'cats',
        filters: { sort: 'views', uploadDate: 'week', duration: 'any', type: 'all' },
        continuation: 'tok',
      },
    });
  });

  it('omits filters/continuation entirely when absent (exactOptionalPropertyTypes)', async () => {
    await invoke('yt:search', { query: 'cats' });
    expect(calls[0]!.params).toEqual({ query: 'cats' });
    expect(Object.keys(calls[0]!.params as object)).toEqual(['query']);
  });

  it('falls back to defaults for an invalid filter enum member', async () => {
    await invoke('yt:search', { query: 'cats', filters: { sort: 'not-a-sort' } });
    expect((calls[0]!.params as { filters: { sort: string } }).filters.sort).toBe('relevance');
  });

  it('rejects a missing query', () => expectInvalidInput('yt:search', {}));
  it('rejects a non-string query', () => expectInvalidInput('yt:search', { query: 42 }));
  it('rejects a query over 256 characters', () =>
    expectInvalidInput('yt:search', { query: 'x'.repeat(257) }));
  it('rejects a continuation over 128 characters', () =>
    expectInvalidInput('yt:search', { query: 'cats', continuation: 'x'.repeat(129) }));
  it('rejects a non-object filters', () =>
    expectInvalidInput('yt:search', { query: 'cats', filters: 'nope' }));
});

describe('yt:searchSuggestions (P2-6)', () => {
  it('forwards a trimmed query', async () => {
    await invoke('yt:searchSuggestions', { query: '  cat vide' });
    expect(calls[0]).toEqual({ method: 'getSearchSuggestions', params: { query: 'cat vide' } });
  });

  it('rejects a missing query', () => expectInvalidInput('yt:searchSuggestions', {}));
  it('rejects a non-string query', () =>
    expectInvalidInput('yt:searchSuggestions', { query: null }));
  it('rejects a query over 100 characters', () =>
    expectInvalidInput('yt:searchSuggestions', { query: 'x'.repeat(101) }));
});

describe('yt:comments (P2-6)', () => {
  it('defaults sort to top and forwards continuation', async () => {
    await invoke('yt:comments', { videoId: 'abc123', continuation: 'tok' });
    expect(calls[0]).toEqual({
      method: 'getComments',
      params: { videoId: 'abc123', sort: 'top', continuation: 'tok' },
    });
  });

  it('forwards an explicit newest sort with no continuation', async () => {
    await invoke('yt:comments', { videoId: 'abc123', sort: 'newest' });
    expect(calls[0]!.params).toEqual({ videoId: 'abc123', sort: 'newest' });
  });

  it('rejects a missing videoId', () => expectInvalidInput('yt:comments', { sort: 'top' }));
  it('rejects an invalid sort', () =>
    expectInvalidInput('yt:comments', { videoId: 'abc123', sort: 'trending' }));
  it('rejects a continuation over 128 characters', () =>
    expectInvalidInput('yt:comments', { videoId: 'abc123', continuation: 'x'.repeat(129) }));
});

describe('yt:commentReplies (P2-6)', () => {
  it('forwards the handle', async () => {
    await invoke('yt:commentReplies', { handle: 'replies-first:abc' });
    expect(calls[0]).toEqual({
      method: 'getCommentReplies',
      params: { handle: 'replies-first:abc' },
    });
  });

  it('rejects a missing handle', () => expectInvalidInput('yt:commentReplies', {}));
  it('rejects a non-string handle', () => expectInvalidInput('yt:commentReplies', { handle: 7 }));
  it('rejects a handle over 128 characters', () =>
    expectInvalidInput('yt:commentReplies', { handle: 'x'.repeat(129) }));
});

describe('yt:channel (P2-6)', () => {
  it('forwards channelId, tab and continuation', async () => {
    await invoke('yt:channel', { channelId: 'UC123', tab: 'videos', continuation: 'tok' });
    expect(calls[0]).toEqual({
      method: 'getChannel',
      params: { channelId: 'UC123', tab: 'videos', continuation: 'tok' },
    });
  });

  it('omits continuation when absent', async () => {
    await invoke('yt:channel', { channelId: 'UC123', tab: 'about' });
    expect(calls[0]!.params).toEqual({ channelId: 'UC123', tab: 'about' });
  });

  it('rejects a missing channelId', () => expectInvalidInput('yt:channel', { tab: 'videos' }));
  it('rejects an invalid tab', () =>
    expectInvalidInput('yt:channel', { channelId: 'UC123', tab: 'trending' }));
  it('rejects a channelId over 64 characters', () =>
    expectInvalidInput('yt:channel', { channelId: 'x'.repeat(65), tab: 'videos' }));
});

describe('yt:playlist (P2-6)', () => {
  it('forwards playlistId and continuation', async () => {
    await invoke('yt:playlist', { playlistId: 'PL123', continuation: 'tok' });
    expect(calls[0]).toEqual({
      method: 'getPlaylist',
      params: { playlistId: 'PL123', continuation: 'tok' },
    });
  });

  it('rejects a missing playlistId', () => expectInvalidInput('yt:playlist', {}));
  it('rejects a non-string playlistId', () => expectInvalidInput('yt:playlist', { playlistId: 9 }));
  it('rejects a playlistId over 64 characters', () =>
    expectInvalidInput('yt:playlist', { playlistId: 'x'.repeat(65) }));
});

describe('yt:resolveUrl (P2-6)', () => {
  it('forwards the url', async () => {
    await invoke('yt:resolveUrl', { url: 'https://youtu.be/abc123' });
    expect(calls[0]).toEqual({
      method: 'resolveUrl',
      params: { url: 'https://youtu.be/abc123' },
    });
  });

  it('rejects a missing url', () => expectInvalidInput('yt:resolveUrl', {}));
  it('rejects an empty url', () => expectInvalidInput('yt:resolveUrl', { url: '' }));
  it('rejects a url over 2048 characters', () =>
    expectInvalidInput('yt:resolveUrl', { url: 'https://x/' + 'a'.repeat(2048) }));
});
