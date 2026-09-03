import { describe, expect, it } from 'vitest';
import {
  mapChapters,
  mapChaptersFromDescription,
  mapChaptersFromPlayerBar,
  mapMostReplayed,
} from '../innertube/map/chapters.js';

describe('mapChaptersFromPlayerBar', () => {
  const overlays = {
    decorated_player_bar: {
      player_bar: {
        markers_map: [
          {
            value: {
              chapters: [
                { title: 'Intro', time_range_start_millis: 0 },
                { title: 'Middle', time_range_start_millis: 90_000 },
                { title: 'End', time_range_start_millis: 285_000 },
              ],
            },
          },
        ],
      },
    },
  };

  it('maps markers and closes each chapter with the next start / the duration', () => {
    const chapters = mapChaptersFromPlayerBar(overlays, 600);
    expect(chapters).toHaveLength(3);
    expect(chapters[0]).toMatchObject({
      title: 'Intro',
      startSec: 0,
      endSec: 90,
      source: 'youtube',
    });
    expect(chapters[2]).toMatchObject({ startSec: 285, endSec: 600 });
  });

  it('returns [] when the player bar is absent or malformed', () => {
    expect(mapChaptersFromPlayerBar(undefined, 100)).toEqual([]);
    expect(mapChaptersFromPlayerBar({ decorated_player_bar: null }, 100)).toEqual([]);
    expect(
      mapChaptersFromPlayerBar({ decorated_player_bar: { player_bar: { markers_map: [] } } }, 100),
    ).toEqual([]);
  });

  it('drops individual markers missing a title or start', () => {
    const chapters = mapChaptersFromPlayerBar(
      {
        decorated_player_bar: {
          player_bar: {
            markers_map: [
              {
                value: {
                  chapters: [
                    { title: '', time_range_start_millis: 0 },
                    { title: 'Real', time_range_start_millis: 5000 },
                  ],
                },
              },
            ],
          },
        },
      },
      10,
    );
    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.title).toBe('Real');
  });
});

describe('mapChaptersFromDescription', () => {
  it('extracts a multi-timestamp list and strips leading separators from labels', () => {
    const desc = '0:00 - Intro\n1:30 - Rainforest\n4:45 Beaches';
    const chapters = mapChaptersFromDescription(desc, 400);
    expect(chapters.map((c) => [c.title, c.startSec, c.endSec])).toEqual([
      ['Intro', 0, 90],
      ['Rainforest', 90, 285],
      ['Beaches', 285, 400],
    ]);
    expect(chapters[0]?.source).toBe('description');
  });

  it('needs at least two timestamps to be a chapter list', () => {
    expect(mapChaptersFromDescription('see 3:15 for the drone bit', 400)).toEqual([]);
    expect(mapChaptersFromDescription('', 400)).toEqual([]);
  });
});

describe('mapChapters (priority)', () => {
  it('prefers the player bar over the description', () => {
    const chapters = mapChapters({
      overlays: {
        decorated_player_bar: {
          player_bar: {
            markers_map: [
              {
                value: {
                  chapters: [
                    { title: 'Bar A', time_range_start_millis: 0 },
                    { title: 'Bar B', time_range_start_millis: 1000 },
                  ],
                },
              },
            ],
          },
        },
      },
      description: '0:00 Desc A\n0:30 Desc B',
      durationSec: 60,
    });
    expect(chapters[0]?.title).toBe('Bar A');
  });

  it('falls back to the description when there is no player bar', () => {
    const chapters = mapChapters({
      overlays: null,
      description: '0:00 Desc A\n0:30 Desc B',
      durationSec: 60,
    });
    expect(chapters.map((c) => c.title)).toEqual(['Desc A', 'Desc B']);
  });
});

describe('mapMostReplayed', () => {
  it('normalises heat markers to {positionSec, intensity 0..1}', () => {
    const peaks = mapMostReplayed({
      heat_markers: [
        { time_range_start_millis: 0, heat_marker_intensity_score_normalized: 1 },
        { time_range_start_millis: 62_100, heat_marker_intensity_score_normalized: 0.42 },
        { time_range_start_millis: 120_000, heat_marker_intensity_score_normalized: 3 },
      ],
    });
    expect(peaks).toEqual([
      { positionSec: 0, intensity: 1 },
      { positionSec: 62.1, intensity: 0.42 },
      { positionSec: 120, intensity: 1 },
    ]);
  });

  it('returns [] when absent', () => {
    expect(mapMostReplayed(undefined)).toEqual([]);
    expect(mapMostReplayed({ heat_markers: null })).toEqual([]);
  });
});
