/**
 * A `YouTubeSource` backed by recorded JSON fixtures. **This is what CI uses** —
 * no CI job may contact YouTube (flaky, and datacenter IPs get bot-blocked; see
 * plan F2 / R2). It runs the *real* pure mappers over fixture data, so CI still
 * exercises the churn-prone mapping code.
 *
 * It does no network I/O and no `Innertube.create()`. (It reuses the pure error
 * helpers from `../innertube/errors.ts`, which transitively loads the youtubei.js
 * module for its error classes — module load only, still zero network.)
 */
import {
  err,
  makeLuneError,
  ok,
  type AdapterDiagnostics,
  type ChannelDetail,
  type Comment,
  type CommentPage,
  type LuneError,
  type NavTarget,
  type Paged,
  type PlaylistDetail,
  type Result,
  type SearchPage,
  type StreamManifest,
  type StreamPrefs,
  type VideoDetail,
  type VideoSummary,
} from '@lunetube/shared';
import {
  identityRewriter,
  type GetChannelParams,
  type GetCommentRepliesParams,
  type GetCommentsParams,
  type GetPlaylistParams,
  type GetRelatedParams,
  type MediaUrlRewriters,
  type SearchParams,
  type YouTubeSource,
} from '../contract.js';
import { CLIENT_LADDER } from '../innertube/clients.js';
import { mapPlayabilityStatus, notImplemented } from '../innertube/errors.js';
import { mapChapters } from '../innertube/map/chapters.js';
import {
  mapAudioTracks,
  mapCaptionTracks,
  mapStoryboards,
  mapVideoTracks,
} from '../innertube/map/streams.js';
import { mapDescription, mapFeedVideos, mapVideoDetail } from '../innertube/map/video.js';
import { defaultFixturesDir, loadVideoFixtures, type VideoFixture } from './fixtures.js';

export interface FakeYouTubeSourceOptions {
  /** Directory of `video-*.json` fixtures. Defaults to the package's own. */
  fixturesDir?: string;
  /** Optional URL rewriters (identity by default). */
  rewriters?: Partial<MediaUrlRewriters>;
}

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

export class FakeYouTubeSource implements YouTubeSource {
  readonly #fixtures: Map<string, VideoFixture>;
  readonly #media: (url: URL) => URL;
  readonly #image: (url: URL) => URL;
  readonly #caption: (url: URL) => URL;
  #lastClient: string | null = null;

  constructor(opts: FakeYouTubeSourceOptions = {}) {
    this.#fixtures = loadVideoFixtures(opts.fixturesDir ?? defaultFixturesDir());
    this.#media = opts.rewriters?.media ?? identityRewriter;
    this.#image = opts.rewriters?.image ?? identityRewriter;
    this.#caption = opts.rewriters?.caption ?? identityRewriter;
  }

  #find(videoId: string): VideoFixture | null {
    return this.#fixtures.get(videoId) ?? null;
  }

  #notFound(videoId: string): LuneError {
    return makeLuneError('YT_UNAVAILABLE', `No fixture for video "${videoId}".`, {
      detail: 'fake',
      hint: 'Add a fixture under packages/youtube/tests/fixtures/ or run `pnpm fixtures:record`.',
    });
  }

  async getVideo(params: { videoId: string }): Promise<Result<VideoDetail, LuneError>> {
    const fixture = this.#find(params.videoId);
    if (fixture == null) return err(this.#notFound(params.videoId));
    const detail = mapVideoDetail(fixture);
    if (detail == null) {
      return err(
        makeLuneError('YT_PARSE_CHANGED', 'Fixture has no basic_info.id.', { detail: 'fake' }),
      );
    }
    return ok(detail);
  }

  async getStreams(params: {
    videoId: string;
    prefs: StreamPrefs;
  }): Promise<Result<StreamManifest, LuneError>> {
    void params.prefs;
    const fixture = this.#find(params.videoId);
    if (fixture == null) return err(this.#notFound(params.videoId));

    const playErr = mapPlayabilityStatus(fixture.playability_status);
    if (playErr != null) return err(playErr);

    const adaptive = fixture.streaming_data?.adaptive_formats ?? [];
    const video = mapVideoTracks(adaptive, this.#media);
    const audio = mapAudioTracks(adaptive, this.#media);
    if (video.length === 0 && audio.length === 0) {
      return err(
        makeLuneError('YT_UNAVAILABLE', 'Fixture has no playable formats.', {
          detail: 'fake:no-streaming-data',
          hint: 'This mirrors a video whose streaming_data is missing.',
        }),
      );
    }

    const durationSec = numberOr(fixture.basic_info?.duration, 0);
    const description = mapDescription(fixture);
    this.#lastClient = fixture.meta?.client ?? 'IOS';

    return ok({
      kind: 'dash',
      manifestXml: fixture.dash_manifest_xml ?? synthesizeDash(video, audio, durationSec),
      video,
      audio,
      captions: mapCaptionTracks(fixture.captions, this.#caption),
      storyboards: mapStoryboards(fixture.storyboards, this.#image),
      chapters: mapChapters({ overlays: fixture.player_overlays, description, durationSec }),
      isLive: fixture.basic_info?.is_live === true,
      durationSec,
      expiresAt: fixtureExpiry(fixture.streaming_data),
      client: this.#lastClient,
    });
  }

  async getRelated(params: GetRelatedParams): Promise<Result<Paged<VideoSummary>, LuneError>> {
    const fixture = this.#find(params.videoId);
    if (fixture == null) return err(this.#notFound(params.videoId));
    if (params.continuation != null) {
      // Fixtures hold a single page; a second page is always empty.
      return ok({ items: [] });
    }
    return ok({ items: mapFeedVideos(fixture.watch_next_feed) });
  }

  async getDiagnostics(): Promise<Result<AdapterDiagnostics, LuneError>> {
    return ok({
      youtubeiVersion: 'fake',
      lastClient: this.#lastClient,
      ladder: CLIENT_LADDER.map((entry) => ({
        client: entry.client,
        ok: entry.client === this.#lastClient,
        formats: 0,
        lastError: null,
      })),
    });
  }

  async search(_params: SearchParams): Promise<Result<SearchPage, LuneError>> {
    return err(notImplemented('search'));
  }
  async getSearchSuggestions(_params: { query: string }): Promise<Result<string[], LuneError>> {
    return err(notImplemented('getSearchSuggestions'));
  }
  async getComments(_params: GetCommentsParams): Promise<Result<CommentPage, LuneError>> {
    return err(notImplemented('getComments'));
  }
  async getCommentReplies(
    _params: GetCommentRepliesParams,
  ): Promise<Result<Paged<Comment>, LuneError>> {
    return err(notImplemented('getCommentReplies'));
  }
  async getChannel(
    _params: GetChannelParams,
  ): Promise<Result<ChannelDetail | Paged<VideoSummary>, LuneError>> {
    return err(notImplemented('getChannel'));
  }
  async getPlaylist(_params: GetPlaylistParams): Promise<Result<PlaylistDetail, LuneError>> {
    return err(notImplemented('getPlaylist'));
  }
  async resolveUrl(_params: { url: string }): Promise<Result<NavTarget, LuneError>> {
    return err(notImplemented('resolveUrl'));
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function fixtureExpiry(streamingData: { expires?: unknown } | null | undefined): number {
  const expires = streamingData?.expires;
  if (typeof expires === 'string') {
    const t = Date.parse(expires);
    if (Number.isFinite(t)) return t;
  }
  return Date.now() + FIVE_HOURS_MS;
}

function synthesizeDash(
  video: {
    id: string;
    codec: string;
    bitrate: number;
    width: number;
    height: number;
    fps: number;
    url: string;
  }[],
  audio: { id: string; codec: string; bitrate: number; url: string }[],
  durationSec: number,
): string {
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const videoReps = video
    .map(
      (v) =>
        `      <Representation id="${esc(v.id)}" codecs="${esc(v.codec)}" bandwidth="${v.bitrate}" width="${v.width}" height="${v.height}" frameRate="${v.fps}">\n        <BaseURL>${esc(v.url)}</BaseURL>\n      </Representation>`,
    )
    .join('\n');
  const audioReps = audio
    .map(
      (a) =>
        `      <Representation id="${esc(a.id)}" codecs="${esc(a.codec)}" bandwidth="${a.bitrate}">\n        <BaseURL>${esc(a.url)}</BaseURL>\n      </Representation>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT${Math.max(0, Math.round(durationSec))}S" minBufferTime="PT1.5S" profiles="urn:mpeg:dash:profile:isoff-main:2011">
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
${videoReps}
    </AdaptationSet>
    <AdaptationSet contentType="audio" mimeType="audio/mp4">
${audioReps}
    </AdaptationSet>
  </Period>
</MPD>`;
}
