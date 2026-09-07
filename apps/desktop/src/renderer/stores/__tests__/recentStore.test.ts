import { beforeEach, describe, expect, it } from 'vitest';
import type { ChannelRef } from '@lunetube/shared';
import { CAP, recentToSummary, useRecentStore, type RecentVideo } from '../recentStore.js';

const channel: ChannelRef = { id: 'UC1111111111111111111111', name: 'Lofi Girl', avatarUrl: null };

function video(n: number): RecentVideo {
  return { videoId: `v${n}`, title: `Video ${n}`, thumbnailUrl: null, channel };
}

describe('recentStore', () => {
  beforeEach(() => {
    useRecentStore.getState().clear();
  });

  it('starts empty', () => {
    expect(useRecentStore.getState().recents).toEqual([]);
  });

  it('records a visit newest-first', () => {
    const { recordVisit } = useRecentStore.getState();
    recordVisit(video(1));
    recordVisit(video(2));
    expect(useRecentStore.getState().recents.map((r) => r.videoId)).toEqual(['v2', 'v1']);
  });

  it('moves a re-visited video to the front without duplicating it', () => {
    const { recordVisit } = useRecentStore.getState();
    recordVisit(video(1));
    recordVisit(video(2));
    recordVisit(video(3));
    recordVisit(video(1));
    expect(useRecentStore.getState().recents.map((r) => r.videoId)).toEqual(['v1', 'v3', 'v2']);
  });

  it('replaces the stored entry on re-visit (title/thumbnail can change)', () => {
    const { recordVisit } = useRecentStore.getState();
    recordVisit(video(1));
    recordVisit({ ...video(1), title: 'Renamed', thumbnailUrl: 'http://127.0.0.1:9/img?u=x' });
    const [first] = useRecentStore.getState().recents;
    expect(first).toMatchObject({ videoId: 'v1', title: 'Renamed' });
    expect(useRecentStore.getState().recents).toHaveLength(1);
  });

  it(`caps at ${CAP}, dropping the oldest`, () => {
    const { recordVisit } = useRecentStore.getState();
    for (let n = 1; n <= CAP + 5; n += 1) recordVisit(video(n));
    const ids = useRecentStore.getState().recents.map((r) => r.videoId);
    expect(ids).toHaveLength(CAP);
    expect(ids[0]).toBe(`v${CAP + 5}`); // newest
    expect(ids.at(-1)).toBe('v6'); // v1..v5 fell off
  });

  it('ignores an empty video id', () => {
    useRecentStore.getState().recordVisit({ ...video(1), videoId: '' });
    expect(useRecentStore.getState().recents).toEqual([]);
  });

  it('recentToSummary fills the unknown fields with null / false', () => {
    expect(recentToSummary(video(7))).toEqual({
      id: 'v7',
      title: 'Video 7',
      channel,
      durationSec: null,
      thumbnailUrl: null,
      publishedText: null,
      viewCount: null,
      isLive: false,
    });
  });
});
