import { useEffect, type RefObject } from 'react';
import { create } from 'zustand';
import type {
  AudioOption,
  PlaybackStatus,
  PlayerHealth,
  QualitySelection,
  TextOption,
  TextSelection,
  TrackSnapshot,
} from './PlaybackEngine.js';

/**
 * The renderer's mirror of the `<video>` element (plan, "Architecture → State
 * management": *"the `<video>` element remains the source of truth for
 * time/buffer; the store mirrors it on a rAF-throttled tick so React doesn't
 * re-render per timeupdate"*).
 *
 * Two rules make that claim actually hold:
 *
 * 1. **Nothing writes playback state into this store except `syncFromElement`.**
 *    Controls call the engine, the engine mutates the element, the tick reads
 *    it back. There is no optimistic local copy that can drift.
 * 2. **The tick only `set`s fields whose value changed.** Zustand notifies every
 *    subscriber on any `set`, but each control subscribes through a selector,
 *    so an unchanged slice is `Object.is`-equal and does not re-render. A frame
 *    in which nothing moved does no `set` at all. Cost per frame is ~10 scalar
 *    comparisons — O(1), independent of video length or track count.
 */

export interface PlayerState {
  status: PlaybackStatus;
  health: PlayerHealth;

  /** Mirrored from the element. Never written by a control. */
  currentTime: number;
  duration: number;
  /** End of the buffered range containing `currentTime`, in seconds. */
  bufferedEnd: number;
  paused: boolean;
  ended: boolean;
  seeking: boolean;
  volume: number;
  muted: boolean;
  rate: number;

  /** Mirrored from shaka via `PlaybackEngine`'s `onTracks`. */
  videoHeights: number[];
  activeHeight: number | null;
  audio: AudioOption[];
  activeAudioKey: string | null;
  text: TextOption[];
  activeTextKey: TextSelection;

  /** The user's explicit choice, which survives reloads (engine invariant I2). */
  selectedHeight: QualitySelection;
  fullscreen: boolean;

  syncFromElement: (video: HTMLVideoElement) => void;
  setStatus: (status: PlaybackStatus) => void;
  setHealth: (health: PlayerHealth) => void;
  setTracks: (tracks: TrackSnapshot) => void;
  setSelectedHeight: (height: QualitySelection) => void;
  setFullscreen: (fullscreen: boolean) => void;
  reset: () => void;
}

const INITIAL = {
  status: 'idle' as PlaybackStatus,
  health: { degraded: false, reason: null } as PlayerHealth,
  currentTime: 0,
  duration: 0,
  bufferedEnd: 0,
  paused: true,
  ended: false,
  seeking: false,
  volume: 1,
  muted: false,
  rate: 1,
  videoHeights: [] as number[],
  activeHeight: null as number | null,
  audio: [] as AudioOption[],
  activeAudioKey: null as string | null,
  text: [] as TextOption[],
  activeTextKey: 'off' as TextSelection,
  selectedHeight: 'auto' as QualitySelection,
  fullscreen: false,
};

/** Sub-frame time changes are invisible; ignoring them halves the `set` rate. */
const TIME_EPSILON = 1 / 120;

export const usePlayerStore = create<PlayerState>((set, get) => ({
  ...INITIAL,

  syncFromElement: (video) => {
    const state = get();
    const patch: Partial<PlayerState> = {};

    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    if (Math.abs(currentTime - state.currentTime) > TIME_EPSILON) patch.currentTime = currentTime;

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration !== state.duration) patch.duration = duration;

    const bufferedEnd = bufferedEndAt(video, currentTime);
    if (Math.abs(bufferedEnd - state.bufferedEnd) > TIME_EPSILON) patch.bufferedEnd = bufferedEnd;

    if (video.paused !== state.paused) patch.paused = video.paused;
    if (video.ended !== state.ended) patch.ended = video.ended;
    if (video.seeking !== state.seeking) patch.seeking = video.seeking;
    if (video.volume !== state.volume) patch.volume = video.volume;
    if (video.muted !== state.muted) patch.muted = video.muted;
    if (video.playbackRate !== state.rate) patch.rate = video.playbackRate;

    if (Object.keys(patch).length > 0) set(patch);
  },

  setStatus: (status) => {
    if (get().status !== status) set({ status });
  },

  setHealth: (health) => {
    const current = get().health;
    if (current.degraded !== health.degraded || current.reason !== health.reason) set({ health });
  },

  setTracks: (tracks) =>
    set({
      videoHeights: tracks.videoHeights,
      activeHeight: tracks.activeHeight,
      audio: tracks.audio,
      activeAudioKey: tracks.activeAudioKey,
      text: tracks.text,
      activeTextKey: tracks.activeTextKey,
    }),

  setSelectedHeight: (selectedHeight) => set({ selectedHeight }),

  setFullscreen: (fullscreen) => {
    if (get().fullscreen !== fullscreen) set({ fullscreen });
  },

  reset: () => set({ ...INITIAL }),
}));

/** End of the buffered range containing `time` (0 when there is no such range). */
export function bufferedEndAt(video: HTMLVideoElement, time: number): number {
  const ranges = video.buffered;
  for (let i = 0; i < ranges.length; i += 1) {
    const start = ranges.start(i);
    const end = ranges.end(i);
    if (time >= start - 0.25 && time <= end) return end;
  }
  return 0;
}

/**
 * Drives `syncFromElement` from `requestAnimationFrame`. rAF (rather than
 * `timeupdate`, which fires at an unspecified 4–66 Hz) keeps the scrubber
 * smooth, and the browser stops calling it entirely when the window is hidden —
 * which is exactly the throttling we want.
 */
export function usePlayerMirror(videoRef: RefObject<HTMLVideoElement | null>): void {
  const syncFromElement = usePlayerStore((s) => s.syncFromElement);

  useEffect(() => {
    let frame = 0;
    const tick = (): void => {
      const video = videoRef.current;
      if (video) syncFromElement(video);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [videoRef, syncFromElement]);
}
