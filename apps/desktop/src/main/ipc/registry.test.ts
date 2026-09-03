import { describe, expect, it, vi } from 'vitest';
import { makeLuneError } from '@lunetube/shared';

type IpcHandler = (event: unknown, payload: unknown) => unknown;
const handlers = new Map<string, IpcHandler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => handlers.set(channel, handler),
  },
}));

const { defineHandler } = await import('./registry.js');

// `yt:video` is a real channel; its exact payload shape is irrelevant here.
const invoke = (payload: unknown) => handlers.get('yt:video')!(null, payload);

describe('defineHandler (F2/F18)', () => {
  it('wraps a successful return in { ok: true, value }', async () => {
    defineHandler('yt:video', () => ({ id: 'abc' }) as never);
    await expect(invoke({ videoId: 'abc' })).resolves.toEqual({ ok: true, value: { id: 'abc' } });
  });

  it('passes a thrown LuneError through with its code and retryable flag intact (F18)', async () => {
    defineHandler('yt:video', () => {
      throw makeLuneError('YT_RATE_LIMITED', 'slow down');
    });
    const res = (await invoke({ videoId: 'abc' })) as {
      ok: false;
      error: { code: string; message: string; retryable: boolean };
    };
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('YT_RATE_LIMITED');
    expect(res.error.message).toBe('slow down');
    expect(res.error.retryable).toBe(true); // NOT flattened to INTERNAL/false
  });

  it('still wraps a genuine unexpected throw as INTERNAL', async () => {
    defineHandler('yt:video', () => {
      throw new Error('boom');
    });
    const res = (await invoke({ videoId: 'abc' })) as {
      ok: false;
      error: { code: string; message: string };
    };
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('INTERNAL');
    expect(res.error.message).toBe('boom');
  });

  it('rejects a payload the validator throws on', async () => {
    defineHandler(
      'yt:video',
      () => ({ id: 'x' }) as never,
      (payload) => {
        if (typeof payload !== 'object' || payload === null) {
          throw makeLuneError('INVALID_INPUT', 'expected an object');
        }
        return payload as { videoId: string };
      },
    );
    const res = (await invoke('not an object')) as { ok: false; error: { code: string } };
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('INVALID_INPUT');
  });
});
