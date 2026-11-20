import type { Result } from './result.js';
import type { LuneError } from './errors.js';
import type { AdapterDiagnostics, NavTarget, Paged } from './models/common.js';
import type { VideoDetail, VideoSummary } from './models/video.js';
import type { StreamManifest, StreamPrefs } from './models/stream.js';
import type { Settings } from './models/settings.js';
import type { WindowState } from './models/window.js';
import type { ChannelRef, ChannelTab } from './models/channel.js';
import type { ChannelPage } from './models/channelPage.js';
import type { Comment, CommentPage, CommentSort } from './models/comment.js';
import type { PlaylistDetail } from './models/playlist.js';
import type { SearchFilters, SearchPage } from './models/search.js';
import type {
  DbScope,
  DbStatus,
  ExportResult,
  FollowedChannel,
  FeedPage,
  HistoryPage,
  ImportResult,
  LocalPlaylistDetail,
  LocalPlaylistSummary,
  QueueAddMode,
  QueueState,
} from './models/library.js';

/**
 * Single source of truth for IPC channel names. Main and preload both import
 * this object so the two sides cannot drift (plan P0-2).
 *
 * Channels are added phase by phase; the `IpcRequests` / `IpcResponses` maps
 * below are the strongly-typed surface and grow alongside. See the plan's IPC
 * table for the full roadmap (search/comments/channel = Phase 2, db:* / feed:* =
 * Phase 3, sb:* + win:setMode = Phase 4, update:* = Phase 5).
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
  dbStatus: 'db:status',
  dbHistoryList: 'db:history.list',
  dbHistoryRecord: 'db:history.record',
  dbHistoryProgress: 'db:history.progress',
  dbHistoryRemove: 'db:history.remove',
  dbHistoryClear: 'db:history.clear',
  dbPlaylistsList: 'db:playlists.list',
  dbPlaylistsGet: 'db:playlists.get',
  dbPlaylistsCreate: 'db:playlists.create',
  dbPlaylistsRename: 'db:playlists.rename',
  dbPlaylistsDelete: 'db:playlists.delete',
  dbPlaylistsAddItem: 'db:playlists.addItem',
  dbPlaylistsRemoveItem: 'db:playlists.removeItem',
  dbPlaylistsMoveItem: 'db:playlists.moveItem',
  dbPlaylistsMembership: 'db:playlists.membership',
  dbFollowsList: 'db:follows.list',
  dbFollowsAdd: 'db:follows.add',
  dbFollowsRemove: 'db:follows.remove',
  dbQueueGet: 'db:queue.get',
  dbQueueAdd: 'db:queue.add',
  dbQueueRemove: 'db:queue.remove',
  dbQueueMove: 'db:queue.move',
  dbQueueClear: 'db:queue.clear',
  dbQueueSetCurrent: 'db:queue.setCurrent',
  dbExport: 'db:export',
  dbImport: 'db:import',
  feedLatest: 'feed:latest',
} as const;

export const EVENT_CHANNELS = {
  winStateChanged: 'win:stateChanged',
  ytHealth: 'yt:health',
  playerRemoteCommand: 'player:remoteCommand',
  dbChanged: 'db:changed',
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
  'db:status': Record<string, never>;
  'db:history.list': {
    query?: string;
    limit?: number;
    cursor?: string;
    incompleteOnly?: boolean;
  };
  'db:history.record': { video: VideoSummary };
  'db:history.progress': { videoId: string; positionSec: number; durationSec: number | null };
  'db:history.remove': { videoId: string };
  'db:history.clear': Record<string, never>;
  'db:playlists.list': Record<string, never>;
  'db:playlists.get': { playlistId: string };
  'db:playlists.create': { name: string };
  'db:playlists.rename': { playlistId: string; name: string };
  'db:playlists.delete': { playlistId: string };
  'db:playlists.addItem': { playlistId: string; video: VideoSummary };
  'db:playlists.removeItem': { playlistId: string; videoId: string };
  'db:playlists.moveItem': { playlistId: string; videoId: string; toIndex: number };
  'db:playlists.membership': { videoId: string };
  'db:follows.list': Record<string, never>;
  'db:follows.add': { channel: ChannelRef & { handle?: string } };
  'db:follows.remove': { channelId: string };
  'db:queue.get': Record<string, never>;
  'db:queue.add': { videos: VideoSummary[]; mode: QueueAddMode };
  'db:queue.remove': { videoId: string };
  'db:queue.move': { videoId: string; toIndex: number };
  'db:queue.clear': Record<string, never>;
  'db:queue.setCurrent': { videoId: string | null };
  'db:export': Record<string, never>;
  'db:import': Record<string, never>;
  'feed:latest': { limit?: number; refresh?: boolean };
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
  'db:status': DbStatus;
  'db:history.list': HistoryPage;
  'db:history.record': void;
  'db:history.progress': void;
  'db:history.remove': void;
  'db:history.clear': void;
  'db:playlists.list': LocalPlaylistSummary[];
  'db:playlists.get': LocalPlaylistDetail;
  'db:playlists.create': LocalPlaylistSummary;
  'db:playlists.rename': void;
  'db:playlists.delete': void;
  'db:playlists.addItem': { added: boolean };
  'db:playlists.removeItem': void;
  'db:playlists.moveItem': void;
  'db:playlists.membership': string[];
  'db:follows.list': FollowedChannel[];
  'db:follows.add': void;
  'db:follows.remove': void;
  'db:queue.get': QueueState;
  'db:queue.add': QueueState;
  'db:queue.remove': QueueState;
  'db:queue.move': QueueState;
  'db:queue.clear': QueueState;
  'db:queue.setCurrent': QueueState;
  'db:export': ExportResult;
  'db:import': ImportResult;
  'feed:latest': FeedPage;
}

export type IpcChannel = keyof IpcRequests;

export type IpcResponse<K extends IpcChannel> = Result<IpcResults[K], LuneError>;

/** events: channel -> payload (main -> renderer, fire-and-forget) */
export interface IpcEvents {
  'win:stateChanged': WindowState;
  'yt:health': { degraded: boolean; reason: string | null };
  'player:remoteCommand': { command: 'playpause' | 'next' | 'previous' | 'stop' };
  'db:changed': { scope: DbScope };
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
