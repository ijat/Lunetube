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

describe('yt:* IPC handlers (P1-4)', () => {
  it('registers all four channels', () => {
    expect([...handlers.keys()].sort()).toEqual([
      'yt:diagnostics',
      'yt:related',
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

  it('yt:related passes a string continuation through and omits it when absent', async () => {
    await invoke('yt:related', { videoId: 'abc123', continuation: 'tok' });
    expect(calls[0]!.params).toEqual({ videoId: 'abc123', continuation: 'tok' });

    calls.length = 0;
    await invoke('yt:related', { videoId: 'abc123' });
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
