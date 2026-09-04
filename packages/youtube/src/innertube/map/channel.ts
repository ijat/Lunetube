/**
 * `Channel` → `ChannelDetail` / `ChannelAbout` / `ChannelTabContent`. Pure — no
 * I/O, no `youtubei.js` import; dispatch on the readonly `node.type` string
 * (P2-F5) to tell `C4TabbedHeader` from the newer `PageHeader` → `PageHeaderView`.
 *
 * Same defensive contract as the rest of `map/**`: every field is read
 * best-effort, a missing or renamed key yields a partial DTO, never a throw.
 * `getAbout()`'s I/O and its `'About not found'` throw are handled by the
 * caller (`source.ts`) — this file only maps whatever shape it received,
 * including `null` (P2-F6).
 */
import type { ChannelAbout, ChannelDetail, ChannelTab, ChannelTabContent } from '@lunetube/shared';
import { mapPlaylistRef, type RawCardNode } from './cards.js';
import type { RawThumbnail } from './thumbnail.js';
import { nonEmpty, parseHumanCount, textToString, type MaybeText } from './util.js';
import { mapFeedVideos, thumbUrl, type ImageRewriter, type RawFeedVideoNode } from './video.js';

// ---------------------------------------------------------------------------
// Structural shapes (mirroring the youtubei.js classes cited in the plan)
// ---------------------------------------------------------------------------

interface RawAuthorLike {
  name?: unknown;
  thumbnails?: RawThumbnail[] | null;
  is_verified?: unknown;
}

/** `ContentMetadataView.metadata_rows[*].metadata_parts[*]`. */
interface RawMetaPart {
  text?: MaybeText;
}
interface RawMetaRow {
  metadata_parts?: (RawMetaPart | null)[] | null;
}

/** `C4TabbedHeader` fields we read, plus `PageHeader.content` (a `PageHeaderView`). */
interface RawHeader {
  type?: unknown;
  author?: RawAuthorLike | null;
  banner?: RawThumbnail[] | null;
  subscribers?: MaybeText;
  videos_count?: MaybeText;
  channel_handle?: MaybeText;
  channel_id?: unknown;
  tagline?: { description?: MaybeText } | null;
  content?: {
    title?: { text?: MaybeText } | null;
    image?: {
      image?: RawThumbnail[] | null;
      avatar?: { image?: RawThumbnail[] | null } | null;
    } | null;
    banner?: { image?: RawThumbnail[] | null } | null;
    description?: { description?: MaybeText } | null;
    metadata?: { metadata_rows?: (RawMetaRow | null)[] | null } | null;
  } | null;
}

/** `ChannelMetadata` — the fallback for every field (P2-4). */
interface RawChannelMetadata {
  external_id?: unknown;
  title?: unknown;
  description?: unknown;
  avatar?: RawThumbnail[] | null;
  vanity_channel_url?: unknown;
}

export interface RawChannel {
  header?: RawHeader | null;
  metadata?: RawChannelMetadata | null;
}

const TAB_FLAGS: readonly [ChannelTab, string][] = [
  ['videos', 'has_videos'],
  ['shorts', 'has_shorts'],
  ['playlists', 'has_playlists'],
  ['live', 'has_live_streams'],
  ['podcasts', 'has_podcasts'],
  ['about', 'has_about'],
];

/**
 * `has_videos` / `has_shorts` / … are cheap `hasTabWithURL` getters
 * (`Channel.js:290-326`) — reading them can't be assumed non-throwing forever,
 * so each read is individually guarded.
 */
function availableTabs(ch: unknown): ChannelTab[] {
  const c = (ch ?? {}) as Record<string, unknown>;
  const out: ChannelTab[] = [];
  for (const [tab, flag] of TAB_FLAGS) {
    try {
      if (c[flag] === true) out.push(tab);
    } catch {
      // Treat a throwing getter as "tab absent".
    }
  }
  return out;
}

function metaRowTexts(rows: (RawMetaRow | null)[] | null | undefined): string[] {
  const out: string[] = [];
  for (const row of rows ?? []) {
    for (const part of row?.metadata_parts ?? []) {
      const t = nonEmpty(part?.text);
      if (t != null) out.push(t);
    }
  }
  return out;
}

function normalizeHandle(value: string | null): string | null {
  if (value == null) return null;
  const h = value.startsWith('@') ? value : `@${value}`;
  return /^@[\w.-]{2,}$/.test(h) ? h : null;
}

/** `https://www.youtube.com/@Foo` → `@Foo`. `PageHeaderView` carries no handle field of its own. */
function handleFromVanityUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const m = /\/(@[\w.-]+)/.exec(url);
  return m?.[1] != null ? normalizeHandle(m[1]) : null;
}

/**
 * `Channel` → `ChannelDetail`. Reads **both** header shapes — `C4TabbedHeader`
 * and the newer `PageHeader` → `content: PageHeaderView` — plus `ch.metadata`
 * (`ChannelMetadata`) as the fallback for every field (plan P2-4).
 */
export function mapChannelDetail(ch: unknown, rewriteImage?: ImageRewriter): ChannelDetail {
  const c = (ch ?? {}) as RawChannel;
  const header = c.header ?? {};
  const meta = c.metadata ?? {};
  const view = header.content ?? null;
  const rowTexts = metaRowTexts(view?.metadata?.metadata_rows);
  const findRow = (re: RegExp): string | null => rowTexts.find((t) => re.test(t)) ?? null;

  const id =
    (typeof meta.external_id === 'string' && meta.external_id) ||
    (typeof header.channel_id === 'string' && header.channel_id) ||
    '';

  const name =
    nonEmpty(header.author?.name as MaybeText) ??
    nonEmpty(view?.title?.text) ??
    nonEmpty(meta.title as MaybeText) ??
    '';

  const avatarUrl =
    thumbUrl(header.author?.thumbnails, rewriteImage, { maxWidth: 176 }) ??
    thumbUrl(view?.image?.avatar?.image ?? view?.image?.image, rewriteImage, { maxWidth: 176 }) ??
    thumbUrl(meta.avatar, rewriteImage, { maxWidth: 176 });

  const bannerUrl =
    thumbUrl(header.banner, rewriteImage) ?? thumbUrl(view?.banner?.image, rewriteImage);

  const handle =
    normalizeHandle(nonEmpty(header.channel_handle)) ??
    handleFromVanityUrl(meta.vanity_channel_url);

  const subscriberText = nonEmpty(header.subscribers) ?? findRow(/subscriber/i);

  const description =
    nonEmpty(view?.description?.description) ??
    nonEmpty(meta.description as MaybeText) ??
    nonEmpty(header.tagline?.description) ??
    '';

  const videoCountRow = findRow(/video/i);
  const videoCount = parseHumanCount(header.videos_count) ?? parseHumanCount(videoCountRow);

  return {
    id,
    name,
    avatarUrl,
    handle,
    subscriberText,
    bannerUrl,
    description,
    videoCount,
    isVerified: header.author?.is_verified === true,
    availableTabs: availableTabs(ch),
  };
}

// ---------------------------------------------------------------------------
// About tab — both `getAbout()` return shapes (P2-F6)
// ---------------------------------------------------------------------------

/** `ChannelAboutFullMetadata`. */
interface RawAboutFull {
  description?: MaybeText;
  view_count?: MaybeText;
  joined_date?: MaybeText;
  country?: MaybeText;
  primary_links?: ({ title?: MaybeText; endpoint?: unknown } | null)[] | null;
}

/** `AboutChannel.metadata` (an `AboutChannelView`). */
interface RawAboutView {
  description?: unknown;
  view_count?: unknown;
  video_count?: unknown;
  subscriber_count?: unknown;
  joined_date?: MaybeText;
  country?: unknown;
  links?: ({ title?: MaybeText; link?: MaybeText } | null)[] | null;
}

/** `AboutChannel` — the wrapper around `metadata: AboutChannelView`. */
interface RawAboutWrapper {
  metadata?: RawAboutView | null;
}

/**
 * Best-effort real URL for one link: prefer the endpoint's `payload.url` /
 * `metadata.url` over the display text (which is often just `"site.com/x"`,
 * with no scheme), unwrap YouTube's `/redirect?q=` wrapper, and always add a
 * scheme before returning. `null` when nothing usable is left. External —
 * never proxy-rewritten (plan P2-4: opened via `app:openExternal`).
 */
function linkUrl(displayText: string, endpoint: unknown): string | null {
  const e = endpoint as { payload?: { url?: unknown }; metadata?: { url?: unknown } } | null;
  const fromEndpoint = e?.payload?.url ?? e?.metadata?.url;
  const raw =
    typeof fromEndpoint === 'string' && fromEndpoint.length > 0 ? fromEndpoint : displayText;
  if (raw.length === 0) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (/(^|\.)youtube\.com$/.test(u.hostname) && u.pathname === '/redirect') {
      const q = u.searchParams.get('q');
      if (q != null && q.length > 0) return q;
    }
    return u.toString();
  } catch {
    return null;
  }
}

function linksFromView(links: RawAboutView['links']): { title: string; url: string }[] {
  const out: { title: string; url: string }[] = [];
  for (const l of links ?? []) {
    if (l == null) continue;
    const title = nonEmpty(l.title) ?? '';
    const url = linkUrl(textToString(l.link), (l.link as { endpoint?: unknown } | null)?.endpoint);
    if (url != null) out.push({ title, url });
  }
  return out;
}

function linksFromPrimary(links: RawAboutFull['primary_links']): { title: string; url: string }[] {
  const out: { title: string; url: string }[] = [];
  for (const l of links ?? []) {
    if (l == null) continue;
    const title = nonEmpty(l.title) ?? '';
    const url = linkUrl(title, l.endpoint);
    if (url != null) out.push({ title, url });
  }
  return out;
}

/**
 * `getAbout()`'s result (`ChannelAboutFullMetadata` **or** `AboutChannel` →
 * `metadata: AboutChannelView`) → `ChannelAbout`. `raw == null` is the
 * degraded case — the caller passes `null` after catching `getAbout()`'s
 * `'About not found'` throw (or any other failure); `fallbackDescription`
 * (`ch.metadata.description`) is what keeps the tab non-empty in that case.
 */
export function mapAbout(raw: unknown, fallbackDescription: string): ChannelAbout {
  const full = (raw ?? {}) as RawAboutFull;
  const view = ((raw as RawAboutWrapper | null)?.metadata ?? {}) as RawAboutView;

  const description =
    nonEmpty(view.description as MaybeText) ?? nonEmpty(full.description) ?? fallbackDescription;

  return {
    description,
    joinedText: nonEmpty(view.joined_date) ?? nonEmpty(full.joined_date),
    viewCountText: nonEmpty(view.view_count as MaybeText) ?? nonEmpty(full.view_count),
    videoCountText: nonEmpty(view.video_count as MaybeText),
    subscriberText: nonEmpty(view.subscriber_count as MaybeText),
    country: nonEmpty(view.country as MaybeText) ?? nonEmpty(full.country),
    links: [...linksFromView(view.links), ...linksFromPrimary(full.primary_links)],
  };
}

// ---------------------------------------------------------------------------
// Tab feed → ChannelTabContent
// ---------------------------------------------------------------------------

/** Read `obj[key]` as an array without letting a throwing getter escape. */
function safeArray(obj: unknown, key: string): unknown[] {
  try {
    const v = (obj as Record<string, unknown> | null)?.[key];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * A `Channel` / `ChannelListContinuation` feed → the tab's `ChannelTabContent`.
 * `videos` / `playlists` are memo-based getters and do not throw (plan P2-4);
 * `safeArray` guards them anyway since a mapper must never throw.
 */
export function mapChannelTabContent(
  tab: ChannelTab,
  feed: unknown,
  rewriteImage?: ImageRewriter,
): ChannelTabContent {
  if (tab === 'playlists') {
    const items = safeArray(feed, 'playlists')
      .map((n) => mapPlaylistRef(n as RawCardNode, rewriteImage))
      .filter((p) => p != null);
    return { kind: 'playlists', items };
  }
  // 'about' never reaches here — `source.ts` short-circuits it before calling
  // a tab getter. Every other tab (videos/shorts/live/podcasts) is a video feed.
  const items = mapFeedVideos(safeArray(feed, 'videos') as RawFeedVideoNode[], rewriteImage);
  return { kind: 'videos', items };
}
