import { makeLuneError, type LuneError, type Result, type StreamPrefs } from '@lunetube/shared';
import { youtubeSource } from '../services/container.js';
import { defineHandler } from './registry.js';

/**
 * `yt:*` IPC handlers (plan P1-4). Each channel forwards its already
 * object-shaped payload straight to the matching `YouTubeSource` method and
 * unwraps the `Result`: a `LuneError` is re-thrown so `defineHandler`'s catch
 * returns it verbatim (`code` + `retryable` intact — F18), which is what the
 * renderer's TanStack Query `retry` predicate keys on.
 *
 * `validate` per channel narrows the untrusted renderer payload before it
 * reaches the adapter (decision A9): a non-empty `videoId`, a `prefs` object,
 * an optional string `continuation`.
 */

async function unwrap<T>(op: Promise<Result<T, LuneError>>): Promise<T> {
  const result = await op;
  if (!result.ok) throw result.error;
  return result.value;
}

function asRecord(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null) {
    throw makeLuneError('INVALID_INPUT', 'payload must be an object');
  }
  return payload as Record<string, unknown>;
}

function requireVideoId(payload: unknown): string {
  const videoId = asRecord(payload)['videoId'];
  if (typeof videoId !== 'string' || videoId.trim() === '') {
    throw makeLuneError('INVALID_INPUT', 'videoId must be a non-empty string');
  }
  return videoId;
}

function requireContinuation(payload: unknown): string | undefined {
  const continuation = asRecord(payload)['continuation'];
  if (continuation !== undefined && typeof continuation !== 'string') {
    throw makeLuneError('INVALID_INPUT', 'continuation must be a string when present');
  }
  return continuation;
}

function requirePrefs(payload: unknown): StreamPrefs {
  const raw = asRecord(payload)['prefs'];
  if (typeof raw !== 'object' || raw === null) {
    throw makeLuneError('INVALID_INPUT', 'prefs must be an object');
  }
  const p = raw as Record<string, unknown>;
  const maxHeight: number | 'auto' =
    p['maxHeight'] === 'auto' ||
    (typeof p['maxHeight'] === 'number' && Number.isFinite(p['maxHeight']))
      ? (p['maxHeight'] as number | 'auto')
      : 'auto';
  return {
    maxHeight,
    preferredAudioLanguage:
      typeof p['preferredAudioLanguage'] === 'string' ? p['preferredAudioLanguage'] : null,
    audioOnly: p['audioOnly'] === true,
  };
}

export function registerYoutubeIpc(): void {
  defineHandler(
    'yt:video',
    ({ videoId }) => unwrap(youtubeSource().getVideo({ videoId })),
    (payload) => ({ videoId: requireVideoId(payload) }),
  );

  defineHandler(
    'yt:streams',
    ({ videoId, prefs }) => unwrap(youtubeSource().getStreams({ videoId, prefs })),
    (payload) => ({ videoId: requireVideoId(payload), prefs: requirePrefs(payload) }),
  );

  defineHandler(
    'yt:related',
    (params) => unwrap(youtubeSource().getRelated(params)),
    (payload) => {
      const videoId = requireVideoId(payload);
      const continuation = requireContinuation(payload);
      return continuation === undefined ? { videoId } : { videoId, continuation };
    },
  );

  defineHandler('yt:diagnostics', () => unwrap(youtubeSource().getDiagnostics()));
}
