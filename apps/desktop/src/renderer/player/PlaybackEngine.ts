import type { StreamManifest } from '@lunetube/shared';

/**
 * `PlaybackEngine` — the shaka-player wrapper and, more importantly, the stream
 * recovery loop (plan P1-5).
 *
 * ## Why this file has no `import 'shaka-player'`
 *
 * The engine talks to shaka through the narrow structural interfaces below
 * (`ShakaPlayerLike` & friends) and receives its player from an injected
 * `createPlayer()` factory. Two reasons, both load-bearing:
 *
 * 1. The unit test can drive the whole recovery state machine against a hand-
 *    written fake without pulling 830 KB of compiled Closure into the test's
 *    module graph, and without `vi.mock` module-registry games.
 * 2. `shakaPlayer.ts` — the real factory — declares its return type as
 *    `ShakaPlayerLike`, so **TypeScript checks at build time that the real
 *    `shaka.Player` still satisfies every method this engine calls.** If shaka
 *    renames or re-signatures one of them on upgrade, the build breaks rather
 *    than the app. That is the conformance guard that keeps the fake honest.
 *
 * ## Invariants this file preserves
 *
 * - **I1 — the `<video>` element is authoritative for time and play state.**
 *   The engine never caches `currentTime`/`paused`; it reads them from the
 *   element at the moment it needs them (`usePlayerStore` mirrors, it does not
 *   own). Recovery therefore always resumes from the true position.
 * - **I2 — track choices are stored as *preferences*, never as shaka track
 *   objects.** shaka invalidates its `Track` objects on every `unload()`, so a
 *   reload would otherwise lose the selection. Preferences (`height | 'auto'`,
 *   an audio key, `lang | 'off'`) survive any number of reloads and are re-
 *   applied by `#applySelection()`.
 * - **I3 — at most one re-resolve is in flight.** A burst of segment failures
 *   collapses to exactly one `resolveManifest()` call: the first qualifying
 *   error arms a debounce timer, every subsequent one sees the armed timer (or
 *   the in-flight recovery) and is dropped.
 * - **I4 — nothing that must stay responsive ever awaits recovery.** The shaka
 *   request filter (which runs on *every* segment request) only arms a timer;
 *   it never returns a promise. `play/pause/seek/setVolume/...` act directly on
 *   the element and are synchronous. Only `attach`/`load`/`recover`/`destroy`
 *   go through the serializer.
 * - **I5 — a superseded operation is a no-op, never a clobber.** `#generation`
 *   is bumped by `load()` and `destroy()`; every recovery re-checks it after
 *   each `await` and abandons if the world moved on. Combined with the
 *   serializer, a recovery can neither interleave with nor overwrite a newer
 *   `load()`.
 * - **I6 — every object URL created is revoked exactly once.** See
 *   `#loadManifest`.
 *
 * ## Concurrency model
 *
 * The renderer is single-threaded, so there are no data races — the hazards are
 * *interleavings across `await` points*. The synchronisation approach is a
 * promise-chain serializer (`#runExclusive`) for the four mutating async
 * operations, plus the `#generation` epoch counter for I5. No locks, no
 * blocking waits, no timers that hold the event loop. This matches the rest of
 * the renderer, which has no async-mutex convention of its own.
 */

/* ------------------------------------------------------------------ *
 * The shaka surface we depend on (structural — see the file header).
 * ------------------------------------------------------------------ */

/** A `shaka.util.FakeEvent`; `detail` carries the `shaka.util.Error` on `error`. */
export interface ShakaEventLike {
  readonly type: string;
  readonly detail?: unknown;
}

/** `shaka.util.Error` — `code` is a `shaka.util.Error.Code`, `data` its varargs. */
export interface ShakaErrorLike {
  readonly code?: unknown;
  readonly category?: unknown;
  readonly severity?: unknown;
  readonly data?: unknown;
}

/** Subset of `shaka.extern.VideoTrack` (5.2.8). Note: **no stable `id`.** */
export interface ShakaVideoTrackLike {
  readonly active: boolean;
  readonly bandwidth: number;
  readonly height: number | null;
  readonly width: number | null;
  readonly frameRate: number | null;
}

/** Subset of `shaka.extern.AudioTrack` (5.2.8). Note: **no stable `id`.** */
export interface ShakaAudioTrackLike {
  readonly active: boolean;
  readonly language: string;
  readonly label: string | null;
  readonly channelsCount: number | null;
  readonly roles: string[];
}

/** Subset of `shaka.extern.TextTrack` (5.2.8). */
export interface ShakaTextTrackLike {
  readonly active: boolean;
  readonly language: string;
  readonly label: string | null;
  readonly kind: string | null;
}

/** Subset of `shaka.extern.Request`. */
export interface ShakaRequestLike {
  readonly uris: string[];
}

/** `shaka.extern.RequestFilter`, narrowed: we never mutate or defer a request. */
export type ShakaRequestFilter = (requestType: number, request: ShakaRequestLike) => void;

export interface ShakaNetworkingEngineLike {
  registerRequestFilter(filter: ShakaRequestFilter): void;
  unregisterRequestFilter(filter: ShakaRequestFilter): void;
}

export interface ShakaPlayerLike {
  attach(mediaElement: HTMLMediaElement): Promise<unknown>;
  load(uri: string, startTime?: number | null, mimeType?: string | null): Promise<unknown>;
  destroy(): Promise<unknown>;
  configure(config: object): boolean;
  addEventListener(type: string, listener: (event: ShakaEventLike) => void): unknown;
  removeEventListener(type: string, listener: (event: ShakaEventLike) => void): unknown;
  getNetworkingEngine(): ShakaNetworkingEngineLike | null;
  getVideoTracks(): ShakaVideoTrackLike[];
  selectVideoTrack(track: ShakaVideoTrackLike, clearBuffer?: boolean, safeMargin?: number): void;
  getAudioTracks(): ShakaAudioTrackLike[];
  selectAudioTrack(track: ShakaAudioTrackLike, safeMargin?: number): void;
  getTextTracks(): ShakaTextTrackLike[];
  selectTextTrack(track?: ShakaTextTrackLike | null): void;
}

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

/**
 * `shaka.util.Error.Code` values we key on. Duplicated as literals so this file
 * stays shaka-free; `shakaPlayer.ts` asserts at module load that shaka's own
 * enum still agrees (a renumbering on upgrade fails loudly instead of silently
 * disabling recovery).
 */
export const SHAKA_ERROR_CODE = {
  /** `data = [uri, httpStatus, responseText, headers, requestType, ...]` */
  BAD_HTTP_STATUS: 1001,
  HTTP_ERROR: 1002,
} as const;

/** `shaka.net.NetworkingEngine.RequestType.SEGMENT`. */
export const SHAKA_REQUEST_TYPE_SEGMENT = 1;

/**
 * HTTP statuses googlevideo returns for an expired or IP-rebound URL. 403 is
 * the documented one (F3); 410 shows up when a URL has been fully retired.
 */
const RECOVERABLE_HTTP_STATUS = new Set([403, 410]);

const MANIFEST_MIME = 'application/dash+xml';

/** Collapses a burst of segment failures into one re-resolve (I3). */
const DEFAULT_RECOVERY_DEBOUNCE_MS = 300;

/**
 * Consecutive recovery attempts before we stop and surface `degraded`. Stopping
 * matters: an unbounded retry loop against a hard 403 hammers YouTube and is a
 * good way to get the user's IP blocked (F2). `retryNow()` clears it.
 */
const MAX_RECOVERY_ATTEMPTS = 2;

/**
 * If a recovery holds for this long with no further qualifying error, the
 * attempt counter resets — so a legitimate second expiry two hours into a long
 * video is a fresh budget, not the straw that degrades the session.
 */
const HEALTHY_RESET_MS = 60_000;

export const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/* ------------------------------------------------------------------ *
 * Public value types
 * ------------------------------------------------------------------ */

export type QualitySelection = number | 'auto';
export type TextSelection = string | 'off';

export type PlaybackStatus = 'idle' | 'loading' | 'ready' | 'recovering' | 'error';

export type RecoveryReason = 'expired' | 'forbidden' | 'network';

export interface PlayerHealth {
  degraded: boolean;
  reason: string | null;
}

export interface AudioOption {
  /** Stable across reloads: shaka's `AudioTrack` has no id, so we derive one. */
  key: string;
  label: string;
  language: string;
}

export interface TextOption {
  /** The BCP-47 language code; also the value accepted by `setTextTrack`. */
  key: string;
  label: string;
}

export interface TrackSnapshot {
  videoHeights: number[];
  activeHeight: number | null;
  audio: AudioOption[];
  activeAudioKey: string | null;
  text: TextOption[];
  activeTextKey: TextSelection;
}

export interface PlaybackEngineOptions {
  /** Constructs a detached `shaka.Player`. See `shakaPlayer.ts`. */
  createPlayer: () => ShakaPlayerLike | Promise<ShakaPlayerLike>;
  /**
   * Forces a fresh `yt:streams` resolve. `PlayerSurface` wires this to the
   * TanStack Query layer (`invalidateQueries` + `fetchQuery`), so the engine
   * stays ignorant of both IPC and the query cache.
   */
  resolveManifest: () => Promise<StreamManifest>;
  onStatus?: (status: PlaybackStatus) => void;
  onTracks?: (tracks: TrackSnapshot) => void;
  onHealth?: (health: PlayerHealth) => void;
  onError?: (error: unknown) => void;
  /** Injected for tests; defaults to `Date.now`. */
  now?: () => number;
  recoveryDebounceMs?: number;
}

/** Base shaka configuration (plan P1-5: ABR on, sane buffering, a few retries). */
export function defaultShakaConfig(): object {
  return {
    abr: {
      enabled: true,
      // ~6 Mbps: high enough to open at 1080p on a normal home connection
      // without stalling, low enough that a slow link recovers within a
      // segment or two. shaka replaces it with a real estimate immediately.
      defaultBandwidthEstimate: 6_000_000,
    },
    streaming: {
      bufferingGoal: 30,
      rebufferingGoal: 4,
      bufferBehind: 30,
      retryParameters: {
        maxAttempts: 3,
        baseDelay: 400,
        backoffFactor: 2,
        fuzzFactor: 0.5,
        timeout: 30_000,
      },
    },
    manifest: {
      retryParameters: { maxAttempts: 2, baseDelay: 300, backoffFactor: 2, timeout: 20_000 },
    },
  };
}

/* ------------------------------------------------------------------ *
 * Engine
 * ------------------------------------------------------------------ */

export class PlaybackEngine {
  readonly #options: PlaybackEngineOptions;
  readonly #now: () => number;
  readonly #debounceMs: number;

  #player: ShakaPlayerLike | null = null;
  #video: HTMLVideoElement | null = null;
  #manifest: StreamManifest | null = null;
  #manifestUrl: string | null = null;

  #status: PlaybackStatus = 'idle';
  #destroyed = false;

  /** Bumped by `load()` and `destroy()`; guards every post-`await` resume (I5). */
  #generation = 0;
  /** Serializes `attach`/`load`/`recover`/`destroy`. */
  #tail: Promise<unknown> = Promise.resolve();

  #recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  #healthyTimer: ReturnType<typeof setTimeout> | null = null;
  #recovering = false;
  #attempts = 0;
  #degraded = false;

  /** Track *preferences* — deliberately not shaka objects (I2). */
  #selection: {
    height: QualitySelection;
    audioKey: string | null;
    text: TextSelection;
  } = { height: 'auto', audioKey: null, text: 'off' };

  readonly #onShakaError = (event: ShakaEventLike): void => {
    const detail = event.detail;
    this.#options.onError?.(detail);
    const reason = classifyShakaError(detail);
    if (reason) this.#scheduleRecovery(reason);
    else this.#setStatus('error');
  };

  readonly #requestFilter: ShakaRequestFilter = (requestType) => {
    // Runs on every segment request — must stay O(1) and must never return a
    // promise (I4: returning one would make shaka await our recovery, which
    // tears down the very request it is waiting on).
    if (requestType !== SHAKA_REQUEST_TYPE_SEGMENT) return;
    const manifest = this.#manifest;
    if (!manifest) return;
    if (this.#now() > manifest.expiresAt) this.#scheduleRecovery('expired');
  };

  constructor(options: PlaybackEngineOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#debounceMs = options.recoveryDebounceMs ?? DEFAULT_RECOVERY_DEBOUNCE_MS;
  }

  /* ---------------------------- lifecycle ---------------------------- */

  /** Creates the shaka player and binds it to `video`. Idempotent per instance. */
  attach(video: HTMLVideoElement): Promise<void> {
    return this.#runExclusive(async () => {
      if (this.#destroyed || this.#player) return;
      const player = await this.#options.createPlayer();
      if (this.#destroyed) {
        void player.destroy();
        return;
      }
      player.configure(defaultShakaConfig());
      player.configure({
        streaming: {
          // Called once shaka has exhausted `retryParameters` on a streaming
          // request. For VOD shaka's own default does nothing and lets the
          // error event fire; we additionally route the qualifying cases into
          // the recovery loop. (Phase 1 is VOD-only — P1-3 returns
          // NOT_IMPLEMENTED for live.)
          failureCallback: (error: ShakaErrorLike) => {
            const reason = classifyShakaError(error);
            if (reason) this.#scheduleRecovery(reason);
          },
        },
      });
      player.addEventListener('error', this.#onShakaError);
      player.addEventListener('trackschanged', this.#onTracksChanged);
      player.addEventListener('adaptation', this.#onTracksChanged);
      player.addEventListener('variantchanged', this.#onTracksChanged);
      player.getNetworkingEngine()?.registerRequestFilter(this.#requestFilter);

      this.#player = player;
      this.#video = video;
      await player.attach(video);
    });
  }

  /** Loads a manifest. Cancels any pending recovery and resets the attempt budget. */
  load(manifest: StreamManifest, startTime?: number): Promise<void> {
    this.#generation += 1;
    this.#clearRecoveryTimer();
    this.#clearHealthyTimer();
    this.#attempts = 0;
    this.#setDegraded(false, null);
    const generation = this.#generation;

    return this.#runExclusive(async () => {
      const player = this.#player;
      if (this.#destroyed || !player || this.#generation !== generation) return;
      this.#manifest = manifest;
      this.#setStatus('loading');
      try {
        await this.#loadManifest(manifest, startTime);
        if (this.#destroyed || this.#generation !== generation) return;
        this.#applySelection();
        this.#emitTracks();
        this.#setStatus('ready');
      } catch (cause) {
        if (this.#destroyed || this.#generation !== generation) return;
        this.#setStatus('error');
        this.#options.onError?.(cause);
        throw cause;
      }
    });
  }

  destroy(): Promise<void> {
    this.#destroyed = true;
    this.#generation += 1;
    this.#clearRecoveryTimer();
    this.#clearHealthyTimer();
    return this.#runExclusive(async () => {
      const player = this.#player;
      this.#player = null;
      this.#video = null;
      this.#manifest = null;
      if (player) {
        player.removeEventListener('error', this.#onShakaError);
        player.removeEventListener('trackschanged', this.#onTracksChanged);
        player.removeEventListener('adaptation', this.#onTracksChanged);
        player.removeEventListener('variantchanged', this.#onTracksChanged);
        player.getNetworkingEngine()?.unregisterRequestFilter(this.#requestFilter);
        try {
          await player.destroy();
        } catch {
          /* a player that failed to build is still gone */
        }
      }
      this.#revokeManifestUrl();
      this.#setStatus('idle');
    });
  }

  /* --------------------------- transport ---------------------------- */
  /* Synchronous and element-direct — never queued, never awaited (I4). */

  play(): void {
    void this.#video?.play().catch(() => {
      /* autoplay rejection is not an error worth surfacing */
    });
  }

  pause(): void {
    this.#video?.pause();
  }

  togglePlay(): void {
    const video = this.#video;
    if (!video) return;
    if (video.paused) this.play();
    else video.pause();
  }

  seek(seconds: number): void {
    const video = this.#video;
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
    video.currentTime = clamp(seconds, 0, duration);
  }

  seekBy(delta: number): void {
    const video = this.#video;
    if (!video) return;
    this.seek(video.currentTime + delta);
  }

  setRate(rate: number): void {
    if (this.#video) this.#video.playbackRate = clamp(rate, 0.0625, 16);
  }

  setVolume(volume: number): void {
    const video = this.#video;
    if (!video) return;
    video.volume = clamp(volume, 0, 1);
    // Nudging the volume up off zero should also un-mute, or the control lies.
    if (video.volume > 0 && video.muted) video.muted = false;
  }

  adjustVolume(delta: number): void {
    const video = this.#video;
    if (!video) return;
    this.setVolume(video.volume + delta);
  }

  setMuted(muted: boolean): void {
    if (this.#video) this.#video.muted = muted;
  }

  toggleMuted(): void {
    const video = this.#video;
    if (video) video.muted = !video.muted;
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.#video;
  }

  getStatus(): PlaybackStatus {
    return this.#status;
  }

  getSelection(): { height: QualitySelection; audioKey: string | null; text: TextSelection } {
    return { ...this.#selection };
  }

  /* ------------------------- track selection ------------------------- */

  /**
   * `'auto'` re-enables ABR; a height pins the closest track at or below it and
   * disables ABR (shaka's ABR would otherwise immediately override the choice).
   */
  selectVideoHeight(height: QualitySelection): void {
    this.#selection.height = height;
    this.#applyVideoSelection();
    this.#emitTracks();
  }

  selectAudioTrack(key: string): void {
    this.#selection.audioKey = key;
    this.#applyAudioSelection();
    this.#emitTracks();
  }

  setTextTrack(selection: TextSelection): void {
    this.#selection.text = selection;
    this.#applyTextSelection();
    this.#emitTracks();
  }

  /* ---------------------------- recovery ----------------------------- */

  /** Clears the degraded latch and re-attempts immediately (the "Retry" button). */
  retryNow(): Promise<void> {
    this.#attempts = 0;
    this.#setDegraded(false, null);
    this.#clearRecoveryTimer();
    return this.#runExclusive(() => this.#recover('network'));
  }

  #scheduleRecovery(reason: RecoveryReason): void {
    if (this.#destroyed || this.#degraded) return;
    if (!this.#manifest || !this.#player) return;
    // I3: the armed timer *is* the burst collapser. Everything that arrives
    // while a timer is pending, or while a recovery is running, is dropped.
    if (this.#recoveryTimer !== null || this.#recovering) return;
    this.#recoveryTimer = setTimeout(() => {
      this.#recoveryTimer = null;
      void this.#runExclusive(() => this.#recover(reason));
    }, this.#debounceMs);
  }

  async #recover(reason: RecoveryReason): Promise<void> {
    const player = this.#player;
    const video = this.#video;
    if (this.#destroyed || !player || !video || !this.#manifest) return;

    if (this.#attempts >= MAX_RECOVERY_ATTEMPTS) {
      this.#setDegraded(true, reason);
      return;
    }

    const generation = this.#generation;
    this.#attempts += 1;
    this.#recovering = true;
    this.#setStatus('recovering');

    // I1: read the truth off the element, at this instant.
    const resumeAt = video.currentTime;
    const wasPlaying = !video.paused && !video.ended;

    try {
      const next = await this.#options.resolveManifest();
      if (this.#destroyed || this.#generation !== generation) return;
      this.#manifest = next;
      await this.#loadManifest(next, resumeAt);
      if (this.#destroyed || this.#generation !== generation) return;

      this.#applySelection();
      this.#emitTracks();
      if (wasPlaying) this.play();
      this.#setStatus('ready');
      this.#armHealthyReset();
    } catch (cause) {
      if (this.#destroyed || this.#generation !== generation) return;
      this.#options.onError?.(cause);
      this.#setStatus('error');
      if (this.#attempts >= MAX_RECOVERY_ATTEMPTS) this.#setDegraded(true, reason);
    } finally {
      this.#recovering = false;
    }
  }

  #armHealthyReset(): void {
    this.#clearHealthyTimer();
    this.#healthyTimer = setTimeout(() => {
      this.#healthyTimer = null;
      this.#attempts = 0;
    }, HEALTHY_RESET_MS);
  }

  #clearRecoveryTimer(): void {
    if (this.#recoveryTimer !== null) {
      clearTimeout(this.#recoveryTimer);
      this.#recoveryTimer = null;
    }
  }

  #clearHealthyTimer(): void {
    if (this.#healthyTimer !== null) {
      clearTimeout(this.#healthyTimer);
      this.#healthyTimer = null;
    }
  }

  #setDegraded(degraded: boolean, reason: RecoveryReason | null): void {
    if (this.#degraded === degraded) return;
    this.#degraded = degraded;
    this.#options.onHealth?.({ degraded, reason: degraded ? degradedReason(reason) : null });
  }

  /* ----------------------------- internals ---------------------------- */

  #runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#tail.then(fn, fn);
    this.#tail = run.then(noop, noop);
    return run;
  }

  /**
   * I6: exactly one revoke per create. The previous URL is revoked *before* the
   * new load starts — safe because shaka fetches a VOD manifest once at
   * `load()` and never refetches it, and the in-flight load uses the new URL,
   * not the old one. (This assumption is VOD-only; a live manifest is
   * periodically refetched. Phase 1 has no live path — P1-3 returns
   * NOT_IMPLEMENTED for live — and Phase 4 must revisit this if that changes.)
   */
  async #loadManifest(manifest: StreamManifest, startTime?: number): Promise<void> {
    const player = this.#player;
    if (!player) throw new Error('PlaybackEngine.load called before attach');

    const url = URL.createObjectURL(new Blob([manifest.manifestXml], { type: MANIFEST_MIME }));
    this.#revokeManifestUrl();
    this.#manifestUrl = url;
    try {
      await player.load(url, startTime ?? null, MANIFEST_MIME);
    } catch (cause) {
      this.#revokeManifestUrl();
      throw cause;
    }
  }

  #revokeManifestUrl(): void {
    if (this.#manifestUrl !== null) {
      URL.revokeObjectURL(this.#manifestUrl);
      this.#manifestUrl = null;
    }
  }

  #setStatus(status: PlaybackStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.#options.onStatus?.(status);
  }

  readonly #onTracksChanged = (): void => {
    this.#emitTracks();
  };

  #applySelection(): void {
    this.#applyVideoSelection();
    this.#applyAudioSelection();
    this.#applyTextSelection();
  }

  #applyVideoSelection(): void {
    const player = this.#player;
    if (!player) return;
    const height = this.#selection.height;
    if (height === 'auto') {
      player.configure({ abr: { enabled: true } });
      return;
    }
    const track = pickVideoTrack(player.getVideoTracks(), height);
    if (!track) {
      // Requested height is gone from this manifest — stay on ABR rather than
      // silently pinning something the user did not ask for.
      player.configure({ abr: { enabled: true } });
      return;
    }
    player.configure({ abr: { enabled: false } });
    player.selectVideoTrack(track, /* clearBuffer */ true, /* safeMargin */ 2);
  }

  #applyAudioSelection(): void {
    const player = this.#player;
    const key = this.#selection.audioKey;
    if (!player || key === null) return;
    const track = player.getAudioTracks().find((t) => audioKeyOf(t) === key);
    if (track && !track.active) player.selectAudioTrack(track);
  }

  #applyTextSelection(): void {
    const player = this.#player;
    if (!player) return;
    const selection = this.#selection.text;
    if (selection === 'off') {
      player.selectTextTrack(null);
      return;
    }
    const tracks = player.getTextTracks();
    // If the requested language is gone (a re-resolved manifest can label a
    // track differently), keep captions *on* with whatever is available rather
    // than silently turning them off — the user asked for subtitles.
    const track = tracks.find((t) => t.language === selection) ?? tracks[0];
    if (track) player.selectTextTrack(track);
    else player.selectTextTrack(null);
  }

  #emitTracks(): void {
    const onTracks = this.#options.onTracks;
    const player = this.#player;
    if (!onTracks || !player) return;

    const videoTracks = player.getVideoTracks();
    const heights = [
      ...new Set(
        videoTracks.map((t) => t.height).filter((h): h is number => typeof h === 'number' && h > 0),
      ),
    ].sort((a, b) => b - a);
    const activeVideo = videoTracks.find((t) => t.active) ?? null;

    const audioTracks = player.getAudioTracks();
    const activeAudio = audioTracks.find((t) => t.active) ?? null;

    const textTracks = player.getTextTracks();
    const activeText = textTracks.find((t) => t.active) ?? null;

    onTracks({
      videoHeights: heights,
      activeHeight: activeVideo?.height ?? null,
      audio: audioTracks.map((t) => ({
        key: audioKeyOf(t),
        label: audioLabelOf(t),
        language: t.language,
      })),
      activeAudioKey: activeAudio ? audioKeyOf(activeAudio) : null,
      text: dedupeByKey(textTracks.map((t) => ({ key: t.language, label: textLabelOf(t) }))),
      activeTextKey: activeText ? activeText.language : 'off',
    });
  }
}

/* ------------------------------------------------------------------ *
 * Pure helpers (exported for the unit test)
 * ------------------------------------------------------------------ */

/**
 * Which shaka errors mean "the googlevideo URLs are dead, go get new ones"?
 * Per the plan: `BAD_HTTP_STATUS` with a 403 (or 410), and any `HTTP_ERROR`.
 * Everything else — a decode error, a manifest parse error — is not fixed by
 * re-resolving and must not spin the loop.
 */
export function classifyShakaError(error: unknown): RecoveryReason | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, data } = error as ShakaErrorLike;
  if (code === SHAKA_ERROR_CODE.HTTP_ERROR) return 'network';
  if (code !== SHAKA_ERROR_CODE.BAD_HTTP_STATUS) return null;
  const status = Array.isArray(data) ? data[1] : undefined;
  return typeof status === 'number' && RECOVERABLE_HTTP_STATUS.has(status) ? 'forbidden' : null;
}

/** Highest track at or below `maxHeight`; the lowest available if none fit. */
export function pickVideoTrack(
  tracks: readonly ShakaVideoTrackLike[],
  maxHeight: number,
): ShakaVideoTrackLike | null {
  const withHeight = tracks.filter(
    (t): t is ShakaVideoTrackLike & { height: number } =>
      typeof t.height === 'number' && t.height > 0,
  );
  if (withHeight.length === 0) return null;
  const eligible = withHeight.filter((t) => t.height <= maxHeight);
  if (eligible.length === 0) {
    // Nothing fits under the cap (e.g. a 144p cap against a 480p-and-up
    // manifest): give the *smallest* available, which is the closest thing to
    // what was asked for. Reducing toward the largest here would hand the user
    // the exact opposite of their request.
    return withHeight.reduce((best, t) =>
      t.height < best.height || (t.height === best.height && t.bandwidth > best.bandwidth)
        ? t
        : best,
    );
  }
  // Highest height under the cap, then highest bitrate at that height.
  return eligible.reduce((best, t) =>
    t.height > best.height || (t.height === best.height && t.bandwidth > best.bandwidth) ? t : best,
  );
}

/** shaka's `AudioTrack` has no id (5.2.8), so derive one that survives reloads. */
export function audioKeyOf(track: ShakaAudioTrackLike): string {
  return `${track.language}|${track.label ?? ''}|${[...track.roles].sort().join(',')}`;
}

function audioLabelOf(track: ShakaAudioTrackLike): string {
  return track.label ?? track.language ?? 'Audio';
}

function textLabelOf(track: ShakaTextTrackLike): string {
  return track.label ?? track.language ?? 'Subtitles';
}

function dedupeByKey<T extends { key: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.key) ? false : (seen.add(item.key), true)));
}

function degradedReason(reason: RecoveryReason | null): string {
  switch (reason) {
    case 'expired':
      return 'Stream URLs expired and could not be renewed.';
    case 'forbidden':
      return 'YouTube refused the media URLs (403) and re-resolving did not help.';
    default:
      return 'The media stream failed repeatedly and could not be recovered.';
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return value < min ? min : value > max ? max : value;
}

function noop(): void {
  /* swallow — the caller of `#runExclusive` owns the outcome */
}
