/* eslint-disable no-restricted-imports -- dev-only fixture recorder legitimately needs youtubei.js */
/**
 * Opt-in fixture recorder:
 * `pnpm fixtures:record [-- --kind video|search|suggestions|channel|playlist --query <q> --id <id>]`.
 *
 * `--kind video` (default) hits YouTube once with the IOS client and writes
 * redacted `video-*.json` fixtures. `--kind search` / `--kind suggestions` write
 * `search-recorded.json` / `suggestions-recorded.json` for a `--query` (default
 * `lofi`). `--kind channel` / `--kind playlist` write `channel-recorded.json`
 * (first page of the `videos` tab plus `getAbout()`) / `playlist-recorded.json`
 * for a `--id` (default a small public channel / playlist). Never run in CI
 * (GitHub IPs are bot-blocked — plan F2/R2) and never committed without
 * eyeballing the output for leaked tokens.
 *
 * Redaction: every googlevideo / timedtext URL is replaced with a synthetic one
 * that keeps only `expire` and `itag`; every ytimg / ggpht / googleusercontent
 * URL is stripped to `origin + pathname` (drops tracking params); `visitor_data`,
 * cookies, `po_token`, `cpn`, `signatureCipher`, `actions`/`session`/`client`
 * back-references and client IP params never reach disk.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Innertube, UniversalCache } from 'youtubei.js';

const TARGETS = [
  { stem: 'video-normal', id: 'LXb3EKWsInQ' },
  { stem: 'video-4k-alt', id: 'aqz-KE-bpKQ' },
];

const FIXTURES_DIR = fileURLToPath(new URL('../tests/fixtures', import.meta.url));
const CACHE_DIR = join(tmpdir(), 'lunetube-fixtures-innertube');

function redactUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return raw;
  try {
    const url = new URL(raw);
    if (/\.googlevideo\.com$/.test(url.hostname)) {
      const expire = url.searchParams.get('expire') ?? '0';
      const itag = url.searchParams.get('itag') ?? '0';
      return `https://rr0---sn-redacted.googlevideo.com/videoplayback?expire=${expire}&itag=${itag}&mime=redacted&id=redacted`;
    }
    if (url.hostname === 'www.youtube.com' && url.pathname === '/api/timedtext') {
      const lang = url.searchParams.get('lang') ?? 'en';
      const kind = url.searchParams.get('kind');
      return `https://www.youtube.com/api/timedtext?v=redacted&lang=${lang}${kind ? `&kind=${kind}` : ''}`;
    }
    return raw;
  } catch {
    return 'https://redacted.example/invalid';
  }
}

/** ytimg / ggpht / googleusercontent → `origin + pathname` (drops query); else `redactUrl`. */
function redactImageUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return raw;
  try {
    const url = new URL(raw);
    if (/(^|\.)(ytimg\.com|ggpht\.com|googleusercontent\.com)$/.test(url.hostname)) {
      return `${url.origin}${url.pathname}`;
    }
    return redactUrl(raw);
  } catch {
    return 'https://redacted.example/invalid';
  }
}

/**
 * Structural deep copy with URL redaction, a recursion cap and a cycle guard —
 * used for the search/suggestions recorders, where the node shapes are deep and
 * varied. Drops the youtubei.js back-reference keys that would otherwise pull in
 * the whole session.
 */
function deepRedact(value, seen = new WeakSet(), depth = 0) {
  if (value == null) return null;
  if (typeof value === 'string') return /^https?:\/\//i.test(value) ? redactImageUrl(value) : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object' || depth > 12) return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 40).map((v) => deepRedact(v, seen, depth + 1));
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === 'actions' || key === 'session' || key === 'client' || key === 'rt') continue;
    const redacted = deepRedact(v, seen, depth + 1);
    if (redacted !== undefined) out[key] = redacted;
  }
  return out;
}

function redactFormat(f) {
  return {
    itag: f.itag,
    url: redactUrl(f.url ?? f.decipher?.() ?? ''),
    mime_type: f.mime_type,
    bitrate: f.bitrate,
    width: f.width,
    height: f.height,
    fps: f.fps,
    has_video: f.has_video,
    has_audio: f.has_audio,
    audio_sample_rate: f.audio_sample_rate,
    audio_channels: f.audio_channels,
    language: f.language ?? null,
    is_original: f.is_original,
    audio_track: f.audio_track
      ? {
          audio_is_default: f.audio_track.audio_is_default,
          display_name: f.audio_track.display_name,
          id: f.audio_track.id,
        }
      : undefined,
  };
}

function text(node) {
  if (node == null) return undefined;
  if (typeof node === 'string') return node;
  if (typeof node.toString === 'function') return node.toString();
  return undefined;
}

async function record({ stem, id }) {
  const yt = await Innertube.create({
    cache: new UniversalCache(true, CACHE_DIR),
    retrieve_player: true,
  });
  const info = await yt.getInfo(id, { client: 'IOS' });

  const fixture = {
    meta: {
      videoId: id,
      client: 'IOS',
      recordedAt: new Date().toISOString(),
      note: 'Recorded by scripts/record-fixtures.mjs — media/caption URLs redacted.',
    },
    playability_status: {
      status: info.playability_status?.status,
      reason: info.playability_status?.reason,
    },
    basic_info: {
      id: info.basic_info?.id,
      title: info.basic_info?.title,
      channel_id: info.basic_info?.channel_id,
      channel: info.basic_info?.channel
        ? {
            id: info.basic_info.channel.id,
            name: info.basic_info.channel.name,
            url: info.basic_info.channel.url,
          }
        : null,
      author: info.basic_info?.author,
      short_description: info.basic_info?.short_description,
      duration: info.basic_info?.duration,
      view_count: info.basic_info?.view_count,
      like_count: info.basic_info?.like_count,
      is_live: info.basic_info?.is_live,
      is_upcoming: info.basic_info?.is_upcoming,
      category: info.basic_info?.category ?? null,
      keywords: info.basic_info?.keywords ?? [],
      thumbnail: info.basic_info?.thumbnail ?? [],
    },
    primary_info: info.primary_info
      ? {
          published: text(info.primary_info.published),
          relative_date: text(info.primary_info.relative_date),
        }
      : null,
    secondary_info: info.secondary_info
      ? {
          description: text(info.secondary_info.description),
          owner: info.secondary_info.owner
            ? {
                subscriber_count: text(info.secondary_info.owner.subscriber_count),
                author: info.secondary_info.owner.author
                  ? {
                      id: info.secondary_info.owner.author.id,
                      name: info.secondary_info.owner.author.name,
                      thumbnails: info.secondary_info.owner.author.thumbnails ?? [],
                    }
                  : null,
              }
            : null,
        }
      : null,
    player_overlays: info.player_overlays?.decorated_player_bar
      ? {
          decorated_player_bar: {
            player_bar: {
              markers_map: (
                info.player_overlays.decorated_player_bar.player_bar?.markers_map ?? []
              ).map((m) => ({
                marker_key: m.marker_key,
                value: {
                  chapters: (m.value?.chapters ?? []).map((c) => ({
                    title: text(c.title),
                    time_range_start_millis: c.time_range_start_millis,
                    thumbnail: c.thumbnail ?? [],
                  })),
                },
              })),
            },
          },
        }
      : null,
    heat_map: info.heat_map
      ? {
          heat_markers: (info.heat_map.heat_markers ?? []).map((h) => ({
            time_range_start_millis: h.time_range_start_millis,
            marker_duration_millis: h.marker_duration_millis,
            heat_marker_intensity_score_normalized: h.heat_marker_intensity_score_normalized,
          })),
        }
      : null,
    streaming_data: info.streaming_data
      ? {
          expires:
            info.streaming_data.expires instanceof Date
              ? info.streaming_data.expires.toISOString()
              : info.streaming_data.expires,
          adaptive_formats: (info.streaming_data.adaptive_formats ?? []).map(redactFormat),
        }
      : null,
    captions: info.captions?.caption_tracks
      ? {
          caption_tracks: info.captions.caption_tracks.map((c) => ({
            base_url: redactUrl(c.base_url),
            name: text(c.name),
            language_code: c.language_code,
            kind: c.kind ?? null,
          })),
        }
      : null,
    storyboards: info.storyboards?.boards
      ? {
          boards: info.storyboards.boards.map((b) => ({
            template_url: redactUrl(b.template_url),
            thumbnail_width: b.thumbnail_width,
            thumbnail_height: b.thumbnail_height,
            thumbnail_count: b.thumbnail_count,
            interval: b.interval,
            columns: b.columns,
            rows: b.rows,
            storyboard_count: b.storyboard_count,
          })),
        }
      : null,
    watch_next_feed: (info.watch_next_feed ?? []).slice(0, 10).map((n) => ({
      video_id: n.video_id ?? n.id,
      title: text(n.title),
      thumbnails: n.thumbnails ?? [],
      author: n.author
        ? { id: n.author.id, name: n.author.name, thumbnails: n.author.thumbnails ?? [] }
        : null,
      short_view_count: text(n.short_view_count),
      published: text(n.published),
      length_text: text(n.length_text),
      is_live: Boolean(n.is_live),
    })),
    dash_manifest_xml: await info
      .toDash({
        url_transformer: (u) => new URL(redactUrl(u.toString())),
        manifest_options: { captions_format: 'vtt' },
      })
      .catch(() => undefined),
  };

  const path = `${FIXTURES_DIR}/${stem}.json`;
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${path}`);
}

async function recordSearch(query) {
  const yt = await Innertube.create({
    cache: new UniversalCache(true, CACHE_DIR),
    retrieve_player: false,
  });
  const search = await yt.search(query);
  const fixture = {
    meta: {
      query,
      key: `${query}|relevance|any|any|all`,
      recordedAt: new Date().toISOString(),
      note: 'Recorded by scripts/record-fixtures.mjs --kind search — image URLs redacted.',
    },
    estimated_results: search.estimated_results ?? null,
    has_continuation: search.has_continuation ?? false,
    results: (search.results ?? [])
      .slice(0, 20)
      .map((node) => ({ type: node.type, ...deepRedact(node) })),
  };
  const path = `${FIXTURES_DIR}/search-recorded.json`;
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${path}`);
}

async function recordSuggestions(query) {
  const yt = await Innertube.create({
    cache: new UniversalCache(true, CACHE_DIR),
    retrieve_player: false,
  });
  const suggestions = await yt.getSearchSuggestions(query);
  const path = `${FIXTURES_DIR}/suggestions-recorded.json`;
  writeFileSync(path, `${JSON.stringify({ query, suggestions }, null, 2)}\n`);
  console.log(`wrote ${path}`);
}

async function recordChannel(channelId) {
  const yt = await Innertube.create({
    cache: new UniversalCache(true, CACHE_DIR),
    retrieve_player: false,
  });
  const ch = await yt.getChannel(channelId);
  const videosTab = ch.has_videos ? await ch.getVideos() : null;
  const about = ch.has_about ? await ch.getAbout().catch(() => null) : null;

  const fixture = {
    meta: {
      channelId,
      tab: 'videos',
      key: `${channelId}|videos`,
      recordedAt: new Date().toISOString(),
      note: 'Recorded by scripts/record-fixtures.mjs --kind channel — image URLs redacted.',
    },
    channel: {
      has_videos: ch.has_videos,
      has_shorts: ch.has_shorts,
      has_playlists: ch.has_playlists,
      has_live_streams: ch.has_live_streams,
      has_podcasts: ch.has_podcasts,
      has_about: ch.has_about,
      header: deepRedact(ch.header),
      metadata: deepRedact(ch.metadata),
    },
    feed: videosTab
      ? {
          has_continuation: videosTab.has_continuation,
          videos: (videosTab.videos ?? [])
            .slice(0, 20)
            .map((n) => ({ type: n.type, ...deepRedact(n) })),
        }
      : null,
    about: about ? { type: about.type, ...deepRedact(about) } : null,
  };
  const path = `${FIXTURES_DIR}/channel-recorded.json`;
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${path}`);
}

async function recordPlaylist(playlistId) {
  const yt = await Innertube.create({
    cache: new UniversalCache(true, CACHE_DIR),
    retrieve_player: false,
  });
  const pl = await yt.getPlaylist(playlistId);
  const fixture = {
    meta: {
      playlistId,
      recordedAt: new Date().toISOString(),
      note: 'Recorded by scripts/record-fixtures.mjs --kind playlist — image URLs redacted.',
    },
    info: deepRedact(pl.info),
    videos: (pl.videos ?? []).slice(0, 20).map((n) => ({ type: n.type, ...deepRedact(n) })),
  };
  const path = `${FIXTURES_DIR}/playlist-recorded.json`;
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${path}`);
}

function parseArgs(argv) {
  const out = { kind: 'video', query: 'lofi', id: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--kind') out.kind = argv[(i += 1)];
    else if (argv[i] === '--query') out.query = argv[(i += 1)];
    else if (argv[i] === '--id') out.id = argv[(i += 1)];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
mkdirSync(CACHE_DIR, { recursive: true });
if (args.kind === 'search') {
  await recordSearch(args.query);
} else if (args.kind === 'suggestions') {
  await recordSuggestions(args.query);
} else if (args.kind === 'channel') {
  await recordChannel(args.id ?? 'UCHnyfMqiRRG1u-2MsSQLbXA'); // Veritasium
} else if (args.kind === 'playlist') {
  await recordPlaylist(args.id ?? 'PLbpi6ZahtOH6Blw3RGYpWkSByi_T7Rygb');
} else {
  for (const target of TARGETS) {
    await record(target);
  }
}
console.log('\nDone. Review the JSON for leaked tokens before committing.');
