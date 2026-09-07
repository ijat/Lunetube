import { create } from 'zustand';
import type { ChannelRef, VideoSummary } from '@lunetube/shared';

/**
 * "Continue watching" backing store (plan P2-11 / decision A18).
 *
 * **In-memory and session-scoped — deliberately not persisted.** The
 * architecture rule is "persistence is only in SQLite via `db:*`; the renderer
 * never owns durable state" (see `docs/ARCHITECTURE.md`). Phase 3 swaps the Home
 * shelf's data source to `db:history` without touching the layout, at which
 * point this store goes away. Until then "Continue watching" empties on quit,
 * and the Home UI says so.
 *
 * `recordVisit` is called from the watch route once the video's `VideoDetail`
 * has loaded. Newest first; a re-visit moves the entry to the front rather than
 * duplicating it; capped at `CAP` (older entries fall off the end).
 */

export interface RecentVideo {
  videoId: string;
  title: string;
  thumbnailUrl: string | null;
  channel: ChannelRef;
}

/** Matches decision A18's "recentStore is in-memory cap 10". */
export const CAP = 10;

interface RecentState {
  recents: RecentVideo[];
  recordVisit: (video: RecentVideo) => void;
  clear: () => void;
}

export const useRecentStore = create<RecentState>((set) => ({
  recents: [],

  recordVisit: (video) =>
    set((state) => {
      if (video.videoId.length === 0) return state;
      const withoutDup = state.recents.filter((r) => r.videoId !== video.videoId);
      return { recents: [video, ...withoutDup].slice(0, CAP) };
    }),

  clear: () => set({ recents: [] }),
}));

/**
 * A `RecentVideo` rendered as a `VideoSummary` so the Home shelves can reuse
 * `VideoCard` unchanged. The fields a recent does not carry (duration, view
 * count, publish date) are `null` — `VideoCard` already hides each when absent.
 */
export function recentToSummary(recent: RecentVideo): VideoSummary {
  return {
    id: recent.videoId,
    title: recent.title,
    channel: recent.channel,
    durationSec: null,
    thumbnailUrl: recent.thumbnailUrl,
    publishedText: null,
    viewCount: null,
    isLive: false,
  };
}
