import { ipcMain } from 'electron';
import {
  makeLuneError,
  type IpcChannel,
  type IpcRequests,
  type IpcResults,
  type IpcResponse,
} from '@lunetube/shared';

export type Handler<K extends IpcChannel> = (
  payload: IpcRequests[K],
) => Promise<IpcResults[K]> | IpcResults[K];

/**
 * Registers an `ipcMain.handle` wrapper that always resolves to a `Result` — a
 * thrown error becomes `{ ok: false, error: LuneError }` and never crosses the
 * boundary as a raw stack (plan Architecture → Process & IPC boundary).
 */
export function defineHandler<K extends IpcChannel>(channel: K, handler: Handler<K>): void {
  ipcMain.handle(channel, async (_event, payload: IpcRequests[K]): Promise<IpcResponse<K>> => {
    try {
      return { ok: true, value: await handler(payload) };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return {
        ok: false,
        error: makeLuneError('INTERNAL', message, { detail: `ipc:${channel}` }),
      };
    }
  });
}
