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
  type ChannelPage,
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
import { CLIENT_LADDER, ladderSkipReason } from '../innertube/clients.js';
import { mapPlayabilityStatus, notImplemented } from '../innertube/errors.js';
import { mapFeedVideos, mapVideoDetail } from '../innertube/map/video.js';
import { ClassicDashStrategy } from '../playback/classicDash.js';
import type {
  DashRequest,
  PlaybackInfo,
  PlaybackStrategy,
  UrlRewriter,
} from '../playback/strategy.js';
import { defaultFixturesDir, loadVideoFixtures, type VideoFixture } from './fixtures.js';

export interface FakeYouTubeSourceOptions {
  /** Directory of `video-*.json` fixtures. Defaults to the package's own. */
  fixturesDir?: string;
  /** Optional URL rewriters (identity by default). */
  rewriters?: Partial<MediaUrlRewriters>;
}

export class FakeYouTubeSource implements YouTubeSource {
  readonly #fixtures: Map<string, VideoFixture>;
  readonly #media: UrlRewriter;
  readonly #image: UrlRewriter;
  readonly #caption: UrlRewriter;
  readonly #strategy: PlaybackStrategy = new ClassicDashStrategy();
  #lastClient: string | null = null;
  #lastExpiresAt: number | null = null;

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
    const detail = mapVideoDetail(fixture, this.#image);
    if (detail == null) {
      return err(
        makeLuneError('YT_PARSE_CHANGED', 'Fixture has no basic_info.id.', { detail: 'fake' }),
      );
    }
    return ok(detail);
  }

  /**
   * Runs the **real** `ClassicDashStrategy` over fixture data, with a
   * fixture-backed `toDash` standing in for youtubei.js' generator. That is
   * what makes the fake worth having: CI exercises the actual assembly, the
   * actual URL-rewriting dispatch and the actual expiry rules, and the fake
   * cannot quietly diverge from the InnerTube path (it cannot, for instance,
   * "support" a live stream the real strategy refuses).
   */
  async getStreams(params: {
    videoId: string;
    prefs: StreamPrefs;
  }): Promise<Result<StreamManifest, LuneError>> {
    const fixture = this.#find(params.videoId);
    if (fixture == null) return err(this.#notFound(params.videoId));

    const playErr = mapPlayabilityStatus(fixture.playability_status);
    if (playErr != null) return err(playErr);

    const client = fixture.meta?.client ?? 'IOS';
    const info: PlaybackInfo = {
      ...fixture,
      toDash: (options?: DashRequest) => Promise.resolve(renderFixtureDash(fixture, options)),
    };

    const result = await this.#strategy.resolve(info, {
      client,
      prefs: params.prefs,
      rewriteMedia: this.#media,
      rewriteImage: this.#image,
      rewriteCaption: this.#caption,
    });

    if (result.ok) {
      this.#lastClient = client;
      this.#lastExpiresAt = result.value.expiresAt;
    }
    return result;
  }

  async getRelated(params: GetRelatedParams): Promise<Result<Paged<VideoSummary>, LuneError>> {
    const fixture = this.#find(params.videoId);
    if (fixture == null) return err(this.#notFound(params.videoId));
    return ok({ items: mapFeedVideos(fixture.watch_next_feed, this.#image) });
  }

  async getDiagnostics(): Promise<Result<AdapterDiagnostics, LuneError>> {
    return ok({
      youtubeiVersion: 'fake',
      lastClient: this.#lastClient,
      lastExpiresAt: this.#lastExpiresAt,
      ladder: CLIENT_LADDER.map((entry) => ({
        client: entry.client,
        ok: entry.client === this.#lastClient,
        formats: 0,
        lastError: ladderSkipReason(entry),
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
  async getChannel(_params: GetChannelParams): Promise<Result<ChannelPage, LuneError>> {
    return err(notImplemented('getChannel'));
  }
  async getPlaylist(_params: GetPlaylistParams): Promise<Result<PlaylistDetail, LuneError>> {
    return err(notImplemented('getPlaylist'));
  }
  async resolveUrl(_params: { url: string }): Promise<Result<NavTarget, LuneError>> {
    return err(notImplemented('resolveUrl'));
  }
}

/**
 * A stand-in for youtubei.js' DASH generator, faithful in the ways that matter
 * to the code under test:
 *
 *  - it applies `url_transformer` to **every** URL it emits, media and caption
 *    alike, because the real generator does (v18.0.0
 *    `utils/StreamingInfo.js#getTextSets`) — so the fake exercises the
 *    strategy's per-route dispatch rather than assuming it;
 *  - it only emits caption tracks when `captions_format` is set, as the real
 *    one does, and appends `fmt=` the same way;
 *  - it emits no image/storyboard sets, matching a `toDash()` call that leaves
 *    `include_thumbnails` unset.
 *
 * A fixture's recorded `dash_manifest_xml` is deliberately **not** used here:
 * `scripts/record-fixtures.mjs` writes it with redacted URLs already baked in,
 * so it cannot be re-transformed, and handing shaka a manifest full of
 * unrewritten googlevideo URLs is exactly the failure this step exists to
 * prevent. It stays in the fixture as a recorded reference artifact.
 */
function renderFixtureDash(fixture: VideoFixture, options?: DashRequest): string {
  const transform = options?.url_transformer ?? identityRewriter;
  const captionsFormat = options?.manifest_options?.captions_format;
  const formats = fixture.streaming_data?.adaptive_formats ?? [];
  const durationSec = Number(fixture.basic_info?.duration) || 0;

  const rewrite = (raw: unknown, extraParams?: Record<string, string>): string | null => {
    if (typeof raw !== 'string' || raw.length === 0) return null;
    try {
      const url = new URL(raw);
      for (const [key, value] of Object.entries(extraParams ?? {})) {
        url.searchParams.set(key, value);
      }
      return transform(url).toString();
    } catch {
      return null;
    }
  };

  const sets: string[] = [];
  for (const format of formats) {
    const url = rewrite(format.url);
    if (url == null) continue;
    const mime = String(format.mime_type ?? '');
    const contentType = mime.startsWith('audio/') ? 'audio' : 'video';
    const container = mime.split(';')[0] ?? '';
    const attrs =
      contentType === 'video'
        ? ` width="${Number(format.width) || 0}" height="${Number(format.height) || 0}" frameRate="${Number(format.fps) || 0}"`
        : ` audioSamplingRate="${Number(format.audio_sample_rate) || 0}"`;
    sets.push(
      `    <AdaptationSet contentType="${contentType}" mimeType="${esc(container)}">\n` +
        `      <Representation id="${esc(String(format.itag ?? ''))}" bandwidth="${Number(format.bitrate) || 0}"${attrs}>\n` +
        `        <BaseURL>${esc(url)}</BaseURL>\n` +
        `      </Representation>\n` +
        `    </AdaptationSet>`,
    );
  }

  if (captionsFormat != null) {
    for (const track of fixture.captions?.caption_tracks ?? []) {
      const url = rewrite(track.base_url, { fmt: captionsFormat });
      if (url == null) continue;
      const lang = typeof track.language_code === 'string' ? track.language_code : '';
      sets.push(
        `    <AdaptationSet contentType="text" mimeType="${captionsFormat === 'vtt' ? 'text/vtt' : 'application/ttml+xml'}" lang="${esc(lang)}">\n` +
          `      <Representation id="text-${esc(lang)}" bandwidth="0">\n` +
          `        <BaseURL>${esc(url)}</BaseURL>\n` +
          `      </Representation>\n` +
          `    </AdaptationSet>`,
      );
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT${Math.max(0, Math.round(durationSec))}S" minBufferTime="PT1.5S" profiles="urn:mpeg:dash:profile:isoff-main:2011">
  <Period>
${sets.join('\n')}
  </Period>
</MPD>`;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
