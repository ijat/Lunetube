import type { IpcChannel, IpcRequests, IpcResults, LuneError } from '@lunetube/shared';
import { bridge } from '../bridge.js';

/**
 * An `Error` subclass carrying the `LuneError` fields so a thrown IPC failure
 * survives TanStack Query's error channel with its `code` / `retryable` intact.
 * `queries.ts`'s `retry` predicate keys on `.retryable`.
 */
export class IpcError extends Error {
  readonly code: LuneError['code'];
  readonly retryable: boolean;
  readonly detail: string | undefined;
  readonly hint: string | undefined;

  constructor(error: LuneError) {
    super(error.message);
    this.name = 'IpcError';
    this.code = error.code;
    this.retryable = error.retryable;
    this.detail = error.detail;
    this.hint = error.hint;
  }
}

/**
 * Typed thin wrapper over `window.lune.invoke` for every `yt:*` channel (and
 * the rest of the IPC surface). Unwraps the boundary `Result`: the value on
 * success, a thrown `IpcError` on failure.
 */
export async function invoke<K extends IpcChannel>(
  channel: K,
  payload: IpcRequests[K],
): Promise<IpcResults[K]> {
  const response = await bridge().invoke(channel, payload);
  if (response.ok) return response.value;
  throw new IpcError(response.error);
}
