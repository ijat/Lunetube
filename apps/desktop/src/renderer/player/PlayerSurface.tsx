import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { StreamManifest, StreamPrefs } from '@lunetube/shared';
import { Captions } from 'lucide-react';
import { PlaybackEngine, type QualitySelection } from './PlaybackEngine.js';
import { createShakaPlayer, isPlaybackSupported } from './shakaPlayer.js';
import { usePlayerMirror, usePlayerStore } from './usePlayerStore.js';
import { usePlayerKeyboard } from './useKeyboard.js';
import { invoke } from '../lib/ipc.js';
import { ytKeys, useStreams } from '../lib/queries.js';
import { Timeline } from './controls/Timeline.js';
import { PlayPause } from './controls/PlayPause.js';
import { VolumeControl } from './controls/VolumeControl.js';
import { TimeDisplay } from './controls/TimeDisplay.js';
import { QualityMenu } from './controls/QualityMenu.js';
import { SpeedMenu } from './controls/SpeedMenu.js';
import { FullscreenButton } from './controls/FullscreenButton.js';
import { Pill } from './controls/PillMenu.js';
import './player.css';

/** Phase-1 defaults. Phase 4 sources these from persisted settings. */
export const DEFAULT_STREAM_PREFS: StreamPrefs = {
  maxHeight: 'auto',
  preferredAudioLanguage: null,
  audioOnly: false,
};

export interface PlayerSurfaceProps {
  videoId: string;
  /** Need not be referentially stable — see the `stablePrefs` memo below. */
  prefs?: StreamPrefs;
  poster?: string;
  /** P1-6 uses this to drive description/comment timestamp seeking. */
  onEngineReady?: (engine: PlaybackEngine | null) => void;
}

/**
 * Mounts the `<video>` element, owns one `PlaybackEngine`, and renders the
 * Direction-B control bar. This is the component P1-6's watch route drops into
 * the full-bleed player slot.
 *
 * **How recovery reaches the query layer.** The engine never imports IPC or
 * TanStack Query; it is handed a `resolveManifest()` callback. That callback is
 * `queryClient.fetchQuery({ …ytKeys.streams(id, prefs), staleTime: 0 })`, which
 * (a) forces a real `yt:streams` round-trip, and (b) writes the fresh manifest
 * into the same cache entry `useStreams` observes, so the UI and the engine can
 * never end up on different manifests.
 */
export function PlayerSurface({ videoId, prefs, poster, onEngineReady }: PlayerSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<PlaybackEngine | null>(null);
  const loadedManifestRef = useRef<StreamManifest | null>(null);
  const loadedVideoIdRef = useRef<string | null>(null);

  const queryClient = useQueryClient();

  // Held in a ref, deliberately: if `onEngineReady` were an effect dependency,
  // a caller passing an inline arrow (which P1-6 almost certainly will) would
  // tear down and rebuild the engine — and restart playback — on every single
  // render.
  const onEngineReadyRef = useRef(onEngineReady);
  onEngineReadyRef.current = onEngineReady;

  // `useStreams`'s query key embeds the whole prefs object (P1-4 note), so an
  // inline object literal from the caller would re-key the query on every
  // render. Anchor it on the serialised value instead of demanding that every
  // call site remembers to memoise.
  const prefsSource = prefs ?? DEFAULT_STREAM_PREFS;
  const prefsKey = JSON.stringify(prefsSource);
  const stablePrefs = useMemo(() => JSON.parse(prefsKey) as StreamPrefs, [prefsKey]);

  const { data: manifest, error, isPending } = useStreams(videoId, stablePrefs);

  const setStatus = usePlayerStore((s) => s.setStatus);
  const setTracks = usePlayerStore((s) => s.setTracks);
  const setHealth = usePlayerStore((s) => s.setHealth);
  const setSelectedHeight = usePlayerStore((s) => s.setSelectedHeight);
  const setFullscreen = usePlayerStore((s) => s.setFullscreen);
  const reset = usePlayerStore((s) => s.reset);
  const health = usePlayerStore((s) => s.health);
  const status = usePlayerStore((s) => s.status);
  // A boolean, not the array: shaka fires 'adaptation' during normal ABR and
  // `setTracks` publishes fresh array identities each time. Subscribing to the
  // array would re-render the whole control bar on every quality switch.
  const hasTextTracks = usePlayerStore((s) => s.text.length > 0);
  const activeTextKey = usePlayerStore((s) => s.activeTextKey);

  const resolveManifest = useCallback(async (): Promise<StreamManifest> => {
    const next = await queryClient.fetchQuery<StreamManifest>({
      queryKey: ytKeys.streams(videoId, stablePrefs),
      queryFn: () => invoke('yt:streams', { videoId, prefs: stablePrefs }),
      staleTime: 0,
    });
    // The engine is about to load this itself; record it so the load effect
    // below does not see "new manifest" and restart playback from scratch.
    loadedManifestRef.current = next;
    return next;
  }, [queryClient, videoId, stablePrefs]);

  // ---- engine lifecycle -------------------------------------------------
  // One engine per mount. React 19 StrictMode mounts, unmounts and remounts in
  // dev; because the engine is created *inside* the effect and destroyed by its
  // cleanup, the second mount gets a clean instance rather than a half-torn-down
  // one.
  useEffect(() => {
    if (!isPlaybackSupported()) {
      setStatus('error');
      return;
    }
    const video = videoRef.current;
    if (!video) return;

    const engine = new PlaybackEngine({
      createPlayer: createShakaPlayer,
      resolveManifest,
      onStatus: setStatus,
      onTracks: setTracks,
      onHealth: setHealth,
      onError: (cause) => console.warn('[player]', cause),
    });
    engineRef.current = engine;
    onEngineReadyRef.current?.(engine);
    void engine.attach(video);

    return () => {
      engineRef.current = null;
      loadedManifestRef.current = null;
      loadedVideoIdRef.current = null;
      onEngineReadyRef.current?.(null);
      void engine.destroy();
      reset();
    };
    // `resolveManifest` changes with videoId/prefs, which is exactly when the
    // engine should be rebuilt anyway.
  }, [resolveManifest, setStatus, setTracks, setHealth, reset]);

  // ---- manifest -> engine ----------------------------------------------
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !manifest) return;
    if (loadedManifestRef.current === manifest) return;

    // Same video, a newer manifest (a background refetch): resume where we are
    // rather than restarting. Different video: start from the top.
    const sameVideo = loadedVideoIdRef.current === videoId;
    const resumeAt = sameVideo ? (videoRef.current?.currentTime ?? 0) : 0;

    loadedManifestRef.current = manifest;
    loadedVideoIdRef.current = videoId;
    void engine.load(manifest, resumeAt).catch(() => {
      /* status/health already reported through the engine callbacks */
    });
  }, [manifest, videoId]);

  usePlayerMirror(videoRef);

  // ---- fullscreen -------------------------------------------------------
  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement === container) void document.exitFullscreen();
    else void container.requestFullscreen().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [setFullscreen]);

  // ---- control callbacks (stable; the engine is read from the ref) -------
  const togglePlay = useCallback(() => engineRef.current?.togglePlay(), []);
  const seek = useCallback((seconds: number) => engineRef.current?.seek(seconds), []);
  const seekBy = useCallback((delta: number) => engineRef.current?.seekBy(delta), []);
  const setVolume = useCallback((volume: number) => engineRef.current?.setVolume(volume), []);
  const adjustVolume = useCallback((delta: number) => engineRef.current?.adjustVolume(delta), []);
  const toggleMuted = useCallback(() => engineRef.current?.toggleMuted(), []);
  const setRate = useCallback((rate: number) => engineRef.current?.setRate(rate), []);
  const selectHeight = useCallback(
    (height: QualitySelection) => {
      engineRef.current?.selectVideoHeight(height);
      setSelectedHeight(height);
    },
    [setSelectedHeight],
  );

  const captionsOn = activeTextKey !== 'off';
  const toggleCaptions = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const current = usePlayerStore.getState();
    if (current.activeTextKey !== 'off') engine.setTextTrack('off');
    else {
      const first = current.text[0];
      if (first) engine.setTextTrack(first.key);
    }
  }, []);

  const keyboardHandlers = useMemo(
    () => ({ togglePlay, seekBy, adjustVolume, toggleMuted, toggleFullscreen }),
    [togglePlay, seekBy, adjustVolume, toggleMuted, toggleFullscreen],
  );
  usePlayerKeyboard(keyboardHandlers);

  const overlay = describeOverlay({
    degraded: health.degraded,
    reason: health.reason,
    status,
    isPending,
    hasError: Boolean(error),
    errorMessage: error?.message ?? null,
  });

  return (
    <div className="player" ref={containerRef} data-testid="player-surface">
      <video
        ref={videoRef}
        className="player__video"
        playsInline
        {...(poster === undefined ? {} : { poster })}
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
      />
      <div className="player__amb" aria-hidden="true" />

      {overlay && (
        <div className="player__overlay" role="status">
          <p className="player__overlay-text">{overlay.text}</p>
          {overlay.canRetry && (
            <button
              type="button"
              className="player__overlay-retry"
              onClick={() => void engineRef.current?.retryNow()}
            >
              Retry
            </button>
          )}
        </div>
      )}

      <div className="player__ctl">
        <Timeline onSeek={seek} />
        <div className="player__row">
          <PlayPause onToggle={togglePlay} />
          <VolumeControl onVolume={setVolume} onToggleMuted={toggleMuted} />
          <TimeDisplay />
          <div className="player__right">
            {hasTextTracks && (
              <Pill
                label="Subtitles"
                hot={captionsOn}
                pressed={captionsOn}
                onClick={toggleCaptions}
              >
                <Captions size={13} strokeWidth={1.8} aria-hidden="true" />
                <span>CC</span>
              </Pill>
            )}
            <SpeedMenu onSelect={setRate} />
            <QualityMenu onSelect={selectHeight} />
            <FullscreenButton onToggle={toggleFullscreen} />
          </div>
        </div>
      </div>
    </div>
  );
}

interface OverlayInput {
  degraded: boolean;
  reason: string | null;
  status: string;
  isPending: boolean;
  hasError: boolean;
  errorMessage: string | null;
}

/** Exported for testability; pure. */
export function describeOverlay(input: OverlayInput): { text: string; canRetry: boolean } | null {
  if (input.degraded) {
    return { text: input.reason ?? 'Playback is degraded.', canRetry: true };
  }
  if (input.hasError) {
    return { text: input.errorMessage ?? 'Could not load this stream.', canRetry: true };
  }
  if (input.status === 'recovering') {
    return { text: 'Renewing stream…', canRetry: false };
  }
  if (input.isPending || input.status === 'loading') {
    return { text: 'Loading…', canRetry: false };
  }
  return null;
}
