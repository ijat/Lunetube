/**
 * `@lunetube/youtube` — the YouTube adapter seam (PRD §2).
 *
 * Consumers (the Electron main process) import from here only. `youtubei.js`
 * lives entirely behind `InnertubeYouTubeSource` and is never re-exported.
 */
export type {
  YouTubeSource,
  MediaUrlRewriters,
  GetRelatedParams,
  SearchParams,
  GetCommentsParams,
  GetCommentRepliesParams,
  GetChannelParams,
  GetPlaylistParams,
} from './contract.js';
export { identityRewriter } from './contract.js';

export { InnertubeYouTubeSource } from './innertube/source.js';
export type { InnertubeYouTubeSourceOptions } from './innertube/source.js';

export { CLIENT_LADDER, attemptableClients } from './innertube/clients.js';
export type { ClientLadderEntry, InnerTubeClient } from './innertube/clients.js';

export { FakeYouTubeSource } from './fake/FakeYouTubeSource.js';
export type { FakeYouTubeSourceOptions } from './fake/FakeYouTubeSource.js';
