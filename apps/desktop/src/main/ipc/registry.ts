import { ipcMain } from 'electron';
import {
  isLuneError,
  makeLuneError,
  type IpcChannel,
  type IpcRequests,
  type IpcResults,
  type IpcResponse,
} from '@lunetube/shared';

export type Handler<K extends IpcChannel> = (
  payload: IpcRequests[K],
) => Promise<IpcResults[K]> | IpcResults[K];

/** Narrows an untrusted renderer payload to `IpcRequests[K]` or throws (F2). */
export type PayloadValidator<K extends IpcChannel> = (payload: unknown) => IpcRequests[K];

/**
 * Registers an `ipcMain.handle` wrapper that always resolves to a `Result` — a
 * thrown error becomes `{ ok: false, error: LuneError }` and never crosses the
 * boundary as a raw stack (plan Architecture → Process & IPC boundary).
 *
 * `validate` is the per-channel payload check the plan (P0-4) calls for. Phase 0
 * only wires it for channels that need it; `app:setSettings` additionally
 * re-validates field-by-field in `settings.ts#coerce` before anything is
 * persisted (see decisions.md).
 */
export function defineHandler<K extends IpcChannel>(
  channel: K,
  handler: Handler<K>,
  validate?: PayloadValidator<K>,
): void {
  ipcMain.handle(channel, async (_event, payload: unknown): Promise<IpcResponse<K>> => {
    try {
      const input = validate ? validate(payload) : (payload as IpcRequests[K]);
      return { ok: true, value: await handler(input) };
    } catch (cause) {
      // A deliberately-thrown `LuneError` is a plain object, not an `Error`
      // (`makeLuneError`), so it must pass through with its `code` and
      // `retryable` flag intact rather than being flattened to `INTERNAL` (F18).
      if (isLuneError(cause)) return { ok: false, error: cause };
      const message = cause instanceof Error ? cause.message : String(cause);
      return {
        ok: false,
        error: makeLuneError('INTERNAL', message, { detail: `ipc:${channel}` }),
      };
    }
  });
}
