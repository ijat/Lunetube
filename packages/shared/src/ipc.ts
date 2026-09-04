import type { Result } from './result.js';
import type { LuneError } from './errors.js';
import type { AdapterDiagnostics, NavTarget, Paged } from './models/common.js';
import type { VideoDetail, VideoSummary } from './models/video.js';
import type { StreamManifest, StreamPrefs } from './models/stream.js';
import type { Settings } from './models/settings.js';
import type { WindowState } from './models/window.js';
import type { ChannelTab } from './models/channel.js';
import type { ChannelPage } from './models/channelPage.js';
import type { Comment, CommentPage, CommentSort } from './models/comment.js';
import type { PlaylistDetail } from './models/playlist.js';
import type { SearchFilters, SearchPage } from './models/search.js';

/**
 * Single source of truth for IPC channel names. Main and preload both import
 * this object so the two sides cannot drift (plan P0-2).
 *
 * Channels are added phase by phase; the `IpcRequests` / `IpcResponses` maps
 * below are the strongly-typed surface and grow alongside. See the plan's IPC
 * table for the full roadmap (search/comments/channel = Phase 2, db:* = Phase 3,
 * sb:* + win:setMode = Phase 4, update:* = Phase 5).
 */
export const CHANNELS = {
  ytVideo: 'yt:video',
  ytStreams: 'yt:streams',
  ytRelated: 'yt:related',
  ytSearch: 'yt:search',
  ytSearchSuggestions: 'yt:searchSuggestions',
  ytComments: 'yt:comments',
  ytCommentReplies: 'yt:commentReplies',
  ytChannel: 'yt:channel',
  ytPlaylist: 'yt:playlist',
  ytResolveUrl: 'yt:resolveUrl',
  ytDiagnostics: 'yt:diagnostics',
  appGetSettings: 'app:getSettings',
  appSetSettings: 'app:setSettings',
  appOpenExternal: 'app:openExternal',
  winGetState: 'win:getState',
} as const;

export const EVENT_CHANNELS = {
  winStateChanged: 'win:stateChanged',
  ytHealth: 'yt:health',
  playerRemoteCommand: 'player:remoteCommand',
} as const;

/** invoke: channel -> request payload */
export interface IpcRequests {
  'yt:video': { videoId: string };
  'yt:streams': { videoId: string; prefs: StreamPrefs };
  // A13 / P2-F2: `getWatchNextContinuation()` mutates `VideoInfo` in place, so
  // the up-next rail is single-page — no `continuation` field.
  'yt:related': { videoId: string };
  'yt:search': { query: string; filters?: SearchFilters; continuation?: string };
  'yt:searchSuggestions': { query: string };
  'yt:comments': { videoId: string; sort: CommentSort; continuation?: string };
  'yt:commentReplies': { handle: string };
  'yt:channel': { channelId: string; tab: ChannelTab; continuation?: string };
  'yt:playlist': { playlistId: string; continuation?: string };
  'yt:resolveUrl': { url: string };
  'yt:diagnostics': Record<string, never>;
  'app:getSettings': Record<string, never>;
  'app:setSettings': { patch: Partial<Settings> };
  'app:openExternal': { url: string };
  'win:getState': Record<string, never>;
}

/** invoke: channel -> response value (always wrapped in Result at the boundary) */
export interface IpcResults {
  'yt:video': VideoDetail;
  'yt:streams': StreamManifest;
  'yt:related': Paged<VideoSummary>;
  'yt:search': SearchPage;
  'yt:searchSuggestions': string[];
  'yt:comments': CommentPage;
  'yt:commentReplies': Paged<Comment>;
  'yt:channel': ChannelPage;
  'yt:playlist': PlaylistDetail;
  'yt:resolveUrl': NavTarget;
  'yt:diagnostics': AdapterDiagnostics;
  'app:getSettings': Settings;
  'app:setSettings': Settings;
  'app:openExternal': void;
  'win:getState': WindowState;
}

export type IpcChannel = keyof IpcRequests;

export type IpcResponse<K extends IpcChannel> = Result<IpcResults[K], LuneError>;

/** events: channel -> payload (main -> renderer, fire-and-forget) */
export interface IpcEvents {
  'win:stateChanged': WindowState;
  'yt:health': { degraded: boolean; reason: string | null };
  'player:remoteCommand': { command: 'playpause' | 'next' | 'previous' | 'stop' };
}

export type IpcEventChannel = keyof IpcEvents;

export type HostPlatform = 'darwin' | 'win32' | 'linux';

/** The one object preload exposes on `window.lune`. */
export interface LuneBridge {
  /** Host OS — the renderer is sandboxed and has no `process`. */
  readonly platform: HostPlatform;
  invoke<K extends IpcChannel>(channel: K, payload: IpcRequests[K]): Promise<IpcResponse<K>>;
  on<K extends IpcEventChannel>(channel: K, listener: (payload: IpcEvents[K]) => void): () => void;
}
