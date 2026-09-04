import {
  DEFAULT_SEARCH_FILTERS,
  makeLuneError,
  type ChannelTab,
  type CommentSort,
  type LuneError,
  type Result,
  type SearchDuration,
  type SearchFilters,
  type SearchResultType,
  type SearchSort,
  type SearchUploadDate,
  type StreamPrefs,
} from '@lunetube/shared';
import { youtubeSource } from '../services/container.js';
import { defineHandler } from './registry.js';

/**
 * `yt:*` IPC handlers (plan P1-4, extended P2-6). Each channel forwards its
 * already object-shaped payload straight to the matching `YouTubeSource`
 * method and unwraps the `Result`: a `LuneError` is re-thrown so
 * `defineHandler`'s catch returns it verbatim (`code` + `retryable` intact —
 * F18), which is what the renderer's TanStack Query `retry` predicate keys on.
 *
 * `validate` per channel narrows the untrusted renderer payload before it
 * reaches the adapter (decision A9). The Phase-1 channels validate a
 * non-empty `videoId` and a `prefs` object; the Phase-2 channels below add
 * bounded strings, enum membership checks and a field-by-field rebuild of
 * `SearchFilters` (mirroring `settings.ts#coerce`'s "unknown keys dropped"
 * pattern) so a malformed renderer payload never reaches the adapter or the
 * continuation store.
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

const CHANNEL_TABS: readonly ChannelTab[] = [
  'videos',
  'shorts',
  'playlists',
  'about',
  'live',
  'podcasts',
];
const COMMENT_SORTS: readonly CommentSort[] = ['top', 'newest'];
const SEARCH_SORTS: readonly SearchSort[] = ['relevance', 'views'];
const SEARCH_UPLOAD_DATES: readonly SearchUploadDate[] = ['any', 'today', 'week', 'month', 'year'];
const SEARCH_DURATIONS: readonly SearchDuration[] = ['any', 'short', 'medium', 'long'];
const SEARCH_RESULT_TYPES: readonly SearchResultType[] = ['all', 'video', 'channel', 'playlist'];

function isMember<T extends string>(value: unknown, set: readonly T[]): value is T {
  return typeof value === 'string' && (set as readonly string[]).includes(value);
}

/** A bounded non-empty string field, e.g. `channelId` / `playlistId` / `handle`. */
function requireBoundedString(payload: unknown, field: string, maxLength: number): string {
  const value = asRecord(payload)[field];
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
    throw makeLuneError(
      'INVALID_INPUT',
      `${field} must be a non-empty string of at most ${maxLength} characters`,
    );
  }
  return value;
}

/** Optional `continuation` handle — capped so a huge string never reaches the store lookup. */
function requireContinuation(payload: unknown): string | undefined {
  const value = asRecord(payload)['continuation'];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw makeLuneError('INVALID_INPUT', 'continuation must be a string of at most 128 characters');
  }
  return value;
}

function requireSearchQuery(payload: unknown): string {
  const raw = asRecord(payload)['query'];
  const query = typeof raw === 'string' ? raw.trim() : '';
  if (query.length === 0 || query.length > 256) {
    throw makeLuneError('INVALID_INPUT', 'query must be a string of 1-256 characters');
  }
  return query;
}

function requireSuggestionQuery(payload: unknown): string {
  const raw = asRecord(payload)['query'];
  const query = typeof raw === 'string' ? raw.trim() : '';
  if (query.length === 0 || query.length > 100) {
    throw makeLuneError('INVALID_INPUT', 'query must be a string of 1-100 characters');
  }
  return query;
}

/**
 * Rebuilds `filters` field by field from `DEFAULT_SEARCH_FILTERS` — mirrors
 * `settings.ts#coerce`: an invalid or missing member falls back to the
 * default for that field rather than rejecting the whole payload, and any
 * key not in `SearchFilters` is silently dropped.
 */
function coerceSearchFilters(payload: unknown): SearchFilters | undefined {
  const raw = asRecord(payload)['filters'];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'object' || raw === null) {
    throw makeLuneError('INVALID_INPUT', 'filters must be an object');
  }
  const f = raw as Record<string, unknown>;
  return {
    sort: isMember(f['sort'], SEARCH_SORTS) ? f['sort'] : DEFAULT_SEARCH_FILTERS.sort,
    uploadDate: isMember(f['uploadDate'], SEARCH_UPLOAD_DATES)
      ? f['uploadDate']
      : DEFAULT_SEARCH_FILTERS.uploadDate,
    duration: isMember(f['duration'], SEARCH_DURATIONS)
      ? f['duration']
      : DEFAULT_SEARCH_FILTERS.duration,
    type: isMember(f['type'], SEARCH_RESULT_TYPES) ? f['type'] : DEFAULT_SEARCH_FILTERS.type,
  };
}

function requireCommentSort(payload: unknown): CommentSort {
  const raw = asRecord(payload)['sort'];
  if (raw === undefined) return 'top';
  if (!isMember(raw, COMMENT_SORTS)) {
    throw makeLuneError('INVALID_INPUT', "sort must be one of 'top', 'newest'");
  }
  return raw;
}

function requireChannelTab(payload: unknown): ChannelTab {
  const raw = asRecord(payload)['tab'];
  if (!isMember(raw, CHANNEL_TABS)) {
    throw makeLuneError('INVALID_INPUT', `tab must be one of ${CHANNEL_TABS.join(', ')}`);
  }
  return raw;
}

function requireUrl(payload: unknown): string {
  const raw = asRecord(payload)['url'];
  if (typeof raw !== 'string' || raw.length < 1 || raw.length > 2048) {
    throw makeLuneError('INVALID_INPUT', 'url must be a string of 1-2048 characters');
  }
  return raw;
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

  // A13: the up-next rail is single-page — `getWatchNextContinuation()` mutates
  // `VideoInfo` in place, so no `continuation` is accepted here.
  defineHandler(
    'yt:related',
    ({ videoId }) => unwrap(youtubeSource().getRelated({ videoId })),
    (payload) => ({ videoId: requireVideoId(payload) }),
  );

  defineHandler(
    'yt:search',
    (params) => unwrap(youtubeSource().search(params)),
    (payload) => {
      const query = requireSearchQuery(payload);
      const filters = coerceSearchFilters(payload);
      const continuation = requireContinuation(payload);
      return filters === undefined
        ? continuation === undefined
          ? { query }
          : { query, continuation }
        : continuation === undefined
          ? { query, filters }
          : { query, filters, continuation };
    },
  );

  defineHandler(
    'yt:searchSuggestions',
    ({ query }) => unwrap(youtubeSource().getSearchSuggestions({ query })),
    (payload) => ({ query: requireSuggestionQuery(payload) }),
  );

  defineHandler(
    'yt:comments',
    (params) => unwrap(youtubeSource().getComments(params)),
    (payload) => {
      const videoId = requireVideoId(payload);
      const sort = requireCommentSort(payload);
      const continuation = requireContinuation(payload);
      return continuation === undefined ? { videoId, sort } : { videoId, sort, continuation };
    },
  );

  defineHandler(
    'yt:commentReplies',
    ({ handle }) => unwrap(youtubeSource().getCommentReplies({ handle })),
    (payload) => ({ handle: requireBoundedString(payload, 'handle', 128) }),
  );

  defineHandler(
    'yt:channel',
    (params) => unwrap(youtubeSource().getChannel(params)),
    (payload) => {
      const channelId = requireBoundedString(payload, 'channelId', 64);
      const tab = requireChannelTab(payload);
      const continuation = requireContinuation(payload);
      return continuation === undefined ? { channelId, tab } : { channelId, tab, continuation };
    },
  );

  defineHandler(
    'yt:playlist',
    (params) => unwrap(youtubeSource().getPlaylist(params)),
    (payload) => {
      const playlistId = requireBoundedString(payload, 'playlistId', 64);
      const continuation = requireContinuation(payload);
      return continuation === undefined ? { playlistId } : { playlistId, continuation };
    },
  );

  defineHandler(
    'yt:resolveUrl',
    ({ url }) => unwrap(youtubeSource().resolveUrl({ url })),
    (payload) => ({ url: requireUrl(payload) }),
  );

  defineHandler('yt:diagnostics', () => unwrap(youtubeSource().getDiagnostics()));
}
