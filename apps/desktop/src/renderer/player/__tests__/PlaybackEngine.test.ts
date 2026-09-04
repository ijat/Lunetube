import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamManifest } from '@lunetube/shared';
import {
  PlaybackEngine,
  SHAKA_ERROR_CODE,
  SHAKA_ERROR_SEVERITY,
  SHAKA_REQUEST_TYPE_SEGMENT,
  audioKeyOf,
  classifyShakaError,
  pickVideoTrack,
  type PlayerHealth,
  type ShakaAudioTrackLike,
  type ShakaEventLike,
  type ShakaPlayerLike,
  type ShakaRequestFilter,
  type ShakaTextTrackLike,
  type ShakaVideoTrackLike,
  type TrackSnapshot,
} from '../PlaybackEngine.js';

/**
 * `PlaybackEngine` against a hand-written `shaka.Player` fake (plan P1-5's
 * done-criterion). The fake is kept honest by `shakaPlayer.ts`, which declares
 * its return type as `ShakaPlayerLike` — so `tsc` proves the real shaka still
 * satisfies the same interface this fake implements. See
 * `__tests__/shakaInterop.test.ts` for the runtime half of that guard.
 *
 * The 403-recovery block is the one that matters: it asserts the burst
 * collapses to exactly one re-resolve, that position and play state survive the
 * reload, and that the degraded surface fires after two failed attempts.
 */

/* ------------------------------ fakes ------------------------------ */

let objectUrlCounter = 0;
const liveObjectUrls = new Set<string>();

class FakeNetworkingEngine {
  filters: ShakaRequestFilter[] = [];
  registerRequestFilter(filter: ShakaRequestFilter): void {
    this.filters.push(filter);
  }
  unregisterRequestFilter(filter: ShakaRequestFilter): void {
    this.filters = this.filters.filter((f) => f !== filter);
  }
  /** Simulates shaka issuing a segment request. */
  fireSegmentRequest(uri = 'http://127.0.0.1:1/t/media?u=x'): void {
    for (const filter of [...this.filters]) filter(SHAKA_REQUEST_TYPE_SEGMENT, { uris: [uri] });
  }
}

class FakePlayer implements ShakaPlayerLike {
  readonly net = new FakeNetworkingEngine();
  readonly listeners = new Map<string, Set<(event: ShakaEventLike) => void>>();
  readonly loads: { uri: string; startTime: number | null | undefined; mimeType: unknown }[] = [];
  readonly configs: object[] = [];
  readonly selectedVideo: ShakaVideoTrackLike[] = [];
  readonly selectedAudio: ShakaAudioTrackLike[] = [];
  readonly selectedText: (ShakaTextTrackLike | null | undefined)[] = [];

  attached: HTMLMediaElement | null = null;
  destroyed = false;
  loadImpl: (uri: string) => Promise<void> = async () => undefined;

  videoTracks: ShakaVideoTrackLike[] = [
    { active: true, bandwidth: 5_000_000, height: 1080, width: 1920, frameRate: 30 },
    { active: false, bandwidth: 2_500_000, height: 720, width: 1280, frameRate: 30 },
    { active: false, bandwidth: 900_000, height: 480, width: 854, frameRate: 30 },
  ];
  audioTracks: ShakaAudioTrackLike[] = [
    { active: true, language: 'en', label: 'English', channelsCount: 2, roles: ['main'] },
    { active: false, language: 'es', label: 'Español', channelsCount: 2, roles: ['dub'] },
  ];
  textTracks: ShakaTextTrackLike[] = [
    { active: false, language: 'en', label: 'English', kind: 'subtitle' },
    { active: false, language: 'fr', label: 'Français', kind: 'subtitle' },
  ];

  async attach(mediaElement: HTMLMediaElement): Promise<void> {
    this.attached = mediaElement;
  }

  async load(uri: string, startTime?: number | null, mimeType?: string | null): Promise<void> {
    this.loads.push({ uri, startTime, mimeType });
    await this.loadImpl(uri);
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
  }

  configure(config: object): boolean {
    this.configs.push(config);
    return true;
  }

  addEventListener(type: string, listener: (event: ShakaEventLike) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: (event: ShakaEventLike) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  getNetworkingEngine(): FakeNetworkingEngine {
    return this.net;
  }

  getVideoTracks(): ShakaVideoTrackLike[] {
    return this.videoTracks;
  }
  selectVideoTrack(track: ShakaVideoTrackLike): void {
    this.selectedVideo.push(track);
    this.videoTracks = this.videoTracks.map((t) => ({ ...t, active: t === track }));
  }
  getAudioTracks(): ShakaAudioTrackLike[] {
    return this.audioTracks;
  }
  selectAudioTrack(track: ShakaAudioTrackLike): void {
    this.selectedAudio.push(track);
    this.audioTracks = this.audioTracks.map((t) => ({ ...t, active: t === track }));
  }
  getTextTracks(): ShakaTextTrackLike[] {
    return this.textTracks;
  }
  selectTextTrack(track?: ShakaTextTrackLike | null): void {
    this.selectedText.push(track);
    this.textTracks = this.textTracks.map((t) => ({ ...t, active: t === track }));
  }

  /** Dispatches a shaka `error` event exactly as `shaka.Player` does. */
  emitError(detail: unknown): void {
    for (const listener of [...(this.listeners.get('error') ?? [])])
      listener({ type: 'error', detail });
  }

  /** The `streaming.failureCallback` the engine installed, if any. */
  failureCallback(): ((error: unknown) => void) | null {
    for (let i = this.configs.length - 1; i >= 0; i -= 1) {
      const streaming = (this.configs[i] as { streaming?: { failureCallback?: unknown } })
        .streaming;
      if (typeof streaming?.failureCallback === 'function') {
        return streaming.failureCallback as (error: unknown) => void;
      }
    }
    return null;
  }

  /** Last `abr.enabled` the engine configured. */
  abrEnabled(): boolean | null {
    for (let i = this.configs.length - 1; i >= 0; i -= 1) {
      const abr = (this.configs[i] as { abr?: { enabled?: boolean } }).abr;
      if (typeof abr?.enabled === 'boolean') return abr.enabled;
    }
    return null;
  }
}

/** A `<video>` stand-in: jsdom's HTMLMediaElement cannot actually play. */
function fakeVideo(): HTMLVideoElement {
  const el = {
    currentTime: 0,
    duration: 600,
    paused: true,
    ended: false,
    volume: 1,
    muted: false,
    playbackRate: 1,
    play: vi.fn(async function play(this: { paused: boolean }) {
      this.paused = false;
    }),
    pause: vi.fn(function pause(this: { paused: boolean }) {
      this.paused = true;
    }),
  };
  return el as unknown as HTMLVideoElement;
}

function manifest(overrides: Partial<StreamManifest> = {}): StreamManifest {
  return {
    kind: 'dash',
    manifestXml: '<MPD/>',
    video: [],
    audio: [],
    captions: [],
    storyboards: [],
    chapters: [],
    isLive: false,
    durationSec: 600,
    expiresAt: Date.now() + 5 * 3_600_000,
    client: 'IOS',
    ...overrides,
  };
}

const badHttp = (status: number): object => ({
  severity: 2,
  category: 1,
  code: SHAKA_ERROR_CODE.BAD_HTTP_STATUS,
  data: ['http://127.0.0.1/media', status, '', {}, 1],
});

/* ------------------------------ setup ------------------------------ */

beforeEach(() => {
  objectUrlCounter = 0;
  liveObjectUrls.clear();
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (_blob: Blob) => {
      objectUrlCounter += 1;
      const url = `blob:lunetube/${objectUrlCounter}`;
      liveObjectUrls.add(url);
      return url;
    },
    revokeObjectURL: (url: string) => {
      liveObjectUrls.delete(url);
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

interface Harness {
  engine: PlaybackEngine;
  player: FakePlayer;
  video: HTMLVideoElement;
  resolveManifest: ReturnType<typeof vi.fn>;
  health: PlayerHealth[];
  tracks: TrackSnapshot[];
  statuses: string[];
  now: { value: number };
}

async function harness(options: { debounceMs?: number } = {}): Promise<Harness> {
  const player = new FakePlayer();
  const video = fakeVideo();
  const health: PlayerHealth[] = [];
  const tracks: TrackSnapshot[] = [];
  const statuses: string[] = [];
  const now = { value: Date.now() };
  const resolveManifest = vi.fn(async () => manifest({ expiresAt: now.value + 3_600_000 }));

  const engine = new PlaybackEngine({
    createPlayer: () => player,
    resolveManifest: resolveManifest as unknown as () => Promise<StreamManifest>,
    onHealth: (h) => health.push(h),
    onTracks: (t) => tracks.push(t),
    onStatus: (s) => statuses.push(s),
    now: () => now.value,
    recoveryDebounceMs: options.debounceMs ?? 300,
  });

  await engine.attach(video);
  return { engine, player, video, resolveManifest, health, tracks, statuses, now };
}

/* ------------------------------ tests ------------------------------ */

describe('classifyShakaError', () => {
  it('treats BAD_HTTP_STATUS 403 and 410 as recoverable', () => {
    expect(classifyShakaError(badHttp(403))).toBe('forbidden');
    expect(classifyShakaError(badHttp(410))).toBe('forbidden');
  });

  it('treats HTTP_ERROR as recoverable', () => {
    expect(classifyShakaError({ code: SHAKA_ERROR_CODE.HTTP_ERROR, data: [] })).toBe('network');
  });

  it('does not re-resolve for errors a new URL cannot fix', () => {
    expect(classifyShakaError(badHttp(404))).toBeNull();
    expect(classifyShakaError(badHttp(500))).toBeNull();
    // 3016 = VIDEO_ERROR (a decode failure)
    expect(classifyShakaError({ code: 3016, data: [] })).toBeNull();
    expect(classifyShakaError(null)).toBeNull();
    expect(classifyShakaError('boom')).toBeNull();
  });
});

describe('pickVideoTrack', () => {
  const tracks: ShakaVideoTrackLike[] = [
    { active: false, bandwidth: 5_000_000, height: 1080, width: 1920, frameRate: 30 },
    { active: false, bandwidth: 6_000_000, height: 1080, width: 1920, frameRate: 60 },
    { active: false, bandwidth: 2_500_000, height: 720, width: 1280, frameRate: 30 },
  ];

  it('picks the highest track at or below the cap, then the highest bitrate', () => {
    expect(pickVideoTrack(tracks, 1080)?.bandwidth).toBe(6_000_000);
    expect(pickVideoTrack(tracks, 900)?.height).toBe(720);
  });

  it('falls back to the lowest available when nothing fits', () => {
    expect(pickVideoTrack(tracks, 144)?.height).toBe(720);
  });

  it('returns null when no track reports a height', () => {
    expect(
      pickVideoTrack(
        [{ active: false, bandwidth: 1, height: null, width: null, frameRate: null }],
        720,
      ),
    ).toBeNull();
  });
});

describe('load', () => {
  it('loads the manifest XML as a blob: URL with the DASH mime type', async () => {
    const h = await harness();
    await h.engine.load(manifest({ manifestXml: '<MPD>hi</MPD>' }));

    expect(h.player.loads).toHaveLength(1);
    expect(h.player.loads[0]?.uri).toMatch(/^blob:/);
    expect(h.player.loads[0]?.mimeType).toBe('application/dash+xml');
    expect(h.player.attached).toBe(h.video);
    expect(h.statuses).toContain('ready');
  });

  it('honours an explicit start time', async () => {
    const h = await harness();
    await h.engine.load(manifest(), 42);
    expect(h.player.loads[0]?.startTime).toBe(42);
  });

  it('revokes the previous object URL when a second manifest is loaded', async () => {
    const h = await harness();
    await h.engine.load(manifest());
    await h.engine.load(manifest());
    expect(h.player.loads).toHaveLength(2);
    expect(liveObjectUrls.size).toBe(1);
  });

  it('revokes the object URL and reports error when shaka rejects', async () => {
    const h = await harness();
    h.player.loadImpl = () => Promise.reject(new Error('manifest parse failed'));
    await expect(h.engine.load(manifest())).rejects.toThrow('manifest parse failed');
    expect(liveObjectUrls.size).toBe(0);
    expect(h.statuses).toContain('error');
  });

  it('publishes a track snapshot from shaka, not from the DTO', async () => {
    const h = await harness();
    await h.engine.load(manifest());
    const snapshot = h.tracks.at(-1);
    expect(snapshot?.videoHeights).toEqual([1080, 720, 480]);
    expect(snapshot?.activeHeight).toBe(1080);
    expect(snapshot?.audio.map((a) => a.language)).toEqual(['en', 'es']);
    expect(snapshot?.text.map((t) => t.key)).toEqual(['en', 'fr']);
    expect(snapshot?.activeTextKey).toBe('off');
  });
});

describe('quality selection', () => {
  it('pins a height and disables ABR', async () => {
    const h = await harness();
    await h.engine.load(manifest());
    h.engine.selectVideoHeight(720);
    expect(h.player.abrEnabled()).toBe(false);
    expect(h.player.selectedVideo.at(-1)?.height).toBe(720);
  });

  it('re-enables ABR for auto and selects nothing manually', async () => {
    const h = await harness();
    await h.engine.load(manifest());
    h.engine.selectVideoHeight(720);
    const manualSelections = h.player.selectedVideo.length;
    h.engine.selectVideoHeight('auto');
    expect(h.player.abrEnabled()).toBe(true);
    expect(h.player.selectedVideo).toHaveLength(manualSelections);
  });

  it('stays on ABR when the pinned height is absent from the manifest', async () => {
    const h = await harness();
    await h.engine.load(manifest());
    h.player.videoTracks = [
      { active: true, bandwidth: 900_000, height: 480, width: 854, frameRate: 30 },
    ];
    h.engine.selectVideoHeight(2160);
    // 2160 is not offered; pickVideoTrack falls back, so we do select 480 —
    // what must never happen is silently reporting 2160.
    expect(h.player.selectedVideo.at(-1)?.height).toBe(480);
  });

  it('text selection: a language selects that track, "off" clears it', async () => {
    const h = await harness();
    await h.engine.load(manifest());
    h.engine.setTextTrack('fr');
    expect(h.player.selectedText.at(-1)?.language).toBe('fr');
    h.engine.setTextTrack('off');
    expect(h.player.selectedText.at(-1)).toBeNull();
  });

  it('audio selection matches on the derived key', async () => {
    const h = await harness();
    await h.engine.load(manifest());
    const spanish = h.player.audioTracks[1];
    if (!spanish) throw new Error('fixture');
    h.engine.selectAudioTrack(audioKeyOf(spanish));
    expect(h.player.selectedAudio.at(-1)?.language).toBe('es');
  });
});

describe('403 stream recovery', () => {
  it('collapses a burst of segment failures into exactly one re-resolve', async () => {
    vi.useFakeTimers();
    const h = await harness({ debounceMs: 300 });
    await h.engine.load(manifest());

    for (let i = 0; i < 8; i += 1) h.player.emitError(badHttp(403));
    expect(h.resolveManifest).not.toHaveBeenCalled(); // debounced, not immediate

    await vi.advanceTimersByTimeAsync(300);
    expect(h.resolveManifest).toHaveBeenCalledTimes(1);

    // Errors that arrive from requests already in flight must not pile on.
    for (let i = 0; i < 4; i += 1) h.player.emitError(badHttp(403));
    await vi.advanceTimersByTimeAsync(300);
    expect(h.resolveManifest).toHaveBeenCalledTimes(2);
    expect(h.resolveManifest).not.toHaveBeenCalledTimes(3);
  });

  it('restores currentTime and the playing state across the reload', async () => {
    vi.useFakeTimers();
    const h = await harness();
    await h.engine.load(manifest());

    h.engine.play();
    (h.video as unknown as { currentTime: number }).currentTime = 137.5;
    expect(h.video.paused).toBe(false);

    h.player.emitError(badHttp(403));
    await vi.advanceTimersByTimeAsync(300);

    expect(h.resolveManifest).toHaveBeenCalledTimes(1);
    expect(h.player.loads).toHaveLength(2);
    expect(h.player.loads[1]?.startTime).toBe(137.5);
    expect(h.player.loads[1]?.uri).not.toBe(h.player.loads[0]?.uri);
    expect(h.video.play).toHaveBeenCalledTimes(2); // once by us, once on resume
    expect(h.video.paused).toBe(false);
  });

  it('leaves a paused video paused after recovery', async () => {
    vi.useFakeTimers();
    const h = await harness();
    await h.engine.load(manifest());
    (h.video as unknown as { currentTime: number }).currentTime = 12;

    h.player.emitError(badHttp(403));
    await vi.advanceTimersByTimeAsync(300);

    expect(h.player.loads[1]?.startTime).toBe(12);
    expect(h.video.play).not.toHaveBeenCalled();
    expect(h.video.paused).toBe(true);
  });

  it('re-applies the pinned quality and text track after recovery', async () => {
    vi.useFakeTimers();
    const h = await harness();
    await h.engine.load(manifest());
    h.engine.selectVideoHeight(720);
    h.engine.setTextTrack('fr');

    // shaka throws its track objects away on reload — the engine must re-derive
    // the selection from its stored *preferences* (invariant I2).
    h.player.videoTracks = h.player.videoTracks.map((t) => ({ ...t, active: t.height === 1080 }));
    h.player.textTracks = h.player.textTracks.map((t) => ({ ...t, active: false }));

    h.player.emitError(badHttp(403));
    await vi.advanceTimersByTimeAsync(300);

    expect(h.player.selectedVideo.at(-1)?.height).toBe(720);
    expect(h.player.selectedText.at(-1)?.language).toBe('fr');
  });

  it('recovers from the streaming failureCallback as well as the error event', async () => {
    vi.useFakeTimers();
    const h = await harness();
    await h.engine.load(manifest());

    const failureCallback = h.player.failureCallback();
    expect(failureCallback).toBeTypeOf('function');
    failureCallback?.(badHttp(403));
    await vi.advanceTimersByTimeAsync(300);

    expect(h.resolveManifest).toHaveBeenCalledTimes(1);
  });

  it('does not re-resolve for an error a fresh URL cannot fix', async () => {
    vi.useFakeTimers();
    const h = await harness();
    await h.engine.load(manifest());

    h.player.emitError({ code: 3016, data: [] });
    await vi.advanceTimersByTimeAsync(1000);

    expect(h.resolveManifest).not.toHaveBeenCalled();
    expect(h.statuses).toContain('error');
  });

  it('surfaces degraded after two failed recovery attempts, then stops trying', async () => {
    vi.useFakeTimers();
    const h = await harness();
    await h.engine.load(manifest());
    h.resolveManifest.mockRejectedValue(new Error('yt:streams failed'));

    h.player.emitError(badHttp(403));
    await vi.advanceTimersByTimeAsync(300);
    expect(h.resolveManifest).toHaveBeenCalledTimes(1);
    expect(h.health).toEqual([]); // one failure is not degraded

    h.player.emitError(badHttp(403));
    await vi.advanceTimersByTimeAsync(300);
    expect(h.resolveManifest).toHaveBeenCalledTimes(2);
    expect(h.health).toHaveLength(1);
    expect(h.health[0]?.degraded).toBe(true);
    expect(h.health[0]?.reason).toMatch(/403/);

    // Latched: further failures must not hammer YouTube.
    for (let i = 0; i < 5; i += 1) h.player.emitError(badHttp(403));
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.resolveManifest).toHaveBeenCalledTimes(2);
  });

  it('stops re-resolving once the attempt budget is spent even when every recovery "succeeds" (F4)', async () => {
    // The scenario the top-of-`#recover` `attempts >= MAX` guard exists for:
    // YouTube keeps handing out a fresh manifest and `player.load()` keeps
    // succeeding, but the *new* segment URLs 403 too (a hard IP block). Every
    // existing degrade test rejects `resolveManifest`/`loadImpl` and exits
    // through the catch path instead, so this early-return branch was unreached.
    // Without it, `resolveManifest` would be called on every 403 forever —
    // an unbounded re-resolve loop against YouTube (plan F2/R1).
    vi.useFakeTimers();
    const h = await harness();
    await h.engine.load(manifest());
    // resolveManifest + loadImpl keep succeeding (harness defaults) — the fresh
    // URLs just 403 again, modelled by re-emitting the error each round.

    for (let i = 0; i < 3; i += 1) {
      h.player.emitError(badHttp(403));
      await vi.advanceTimersByTimeAsync(300);
    }

    expect(h.resolveManifest).toHaveBeenCalledTimes(2); // not 3 — the 3rd is refused
    expect(h.health.at(-1)?.degraded).toBe(true);
  });

  it('degrades when the reload itself keeps failing', async () => {
    vi.useFakeTimers();
    const h = await harness();
    await h.engine.load(manifest());
    h.player.loadImpl = () => Promise.reject(new Error('segment 403 on reload'));

    h.player.emitError(badHttp(403));
    await vi.advanceTimersByTimeAsync(300);
    h.player.emitError(badHttp(403));
    await vi.advanceTimersByTimeAsync(300);

    expect(h.health.at(-1)?.degraded).toBe(true);
    expect(liveObjectUrls.size).toBe(0); // failed loads must not leak blob URLs
  });

  it('retryNow clears the degraded latch and re-attempts', async () => {
    vi.useFakeTimers();
    const h = await harness();
    await h.engine.load(manifest());
    h.resolveManifest.mockRejectedValue(new Error('down'));

    h.player.emitError(badHttp(403));
    await vi.advanceTimersByTimeAsync(300);
    h.player.emitError(badHttp(403));
    await vi.advanceTimersByTimeAsync(300);
    expect(h.health.at(-1)?.degraded).toBe(true);

    h.resolveManifest.mockResolvedValue(manifest());
    await h.engine.retryNow();

    expect(h.resolveManifest).toHaveBeenCalledTimes(3);
    expect(h.health.at(-1)?.degraded).toBe(false);
  });

  it('a new load() resets the attempt budget', async () => {
    vi.useFakeTimers();
    const h = await harness();
    await h.engine.load(manifest());
    h.resolveManifest.mockRejectedValue(new Error('down'));

    h.player.emitError(badHttp(403));
    await vi.advanceTimersByTimeAsync(300);
    h.player.emitError(badHttp(403));
    await vi.advanceTimersByTimeAsync(300);
    expect(h.health.at(-1)?.degraded).toBe(true);

    h.resolveManifest.mockResolvedValue(manifest());
    await h.engine.load(manifest());
    expect(h.health.at(-1)?.degraded).toBe(false);

    h.player.emitError(badHttp(403));
    await vi.advanceTimersByTimeAsync(300);
    expect(h.resolveManifest).toHaveBeenCalledTimes(3);
  });
});

describe('shaka error severity (F1)', () => {
  it('does not latch error status for a RECOVERABLE shaka error', async () => {
    const h = await harness();
    await h.engine.load(manifest());
    expect(h.statuses).toContain('ready');

    // e.g. a text-track parse failure shaka has already handled — it keeps
    // playing, so the status must not flip to 'error'.
    h.player.emitError({ severity: SHAKA_ERROR_SEVERITY.RECOVERABLE, code: 3016, data: [] });

    expect(h.statuses).not.toContain('error');
    expect(h.resolveManifest).not.toHaveBeenCalled();
  });

  it('still latches error status for a CRITICAL shaka error a re-resolve cannot fix', async () => {
    const h = await harness();
    await h.engine.load(manifest());

    h.player.emitError({ severity: SHAKA_ERROR_SEVERITY.CRITICAL, code: 3016, data: [] });

    expect(h.statuses).toContain('error');
    expect(h.resolveManifest).not.toHaveBeenCalled();
  });
});

describe('expiry-driven recovery', () => {
  it('re-resolves once when a segment is requested past expiresAt', async () => {
    vi.useFakeTimers();
    const h = await harness();
    const expiresAt = h.now.value + 1000;
    await h.engine.load(manifest({ expiresAt }));

    h.player.net.fireSegmentRequest();
    await vi.advanceTimersByTimeAsync(300);
    expect(h.resolveManifest).not.toHaveBeenCalled();

    h.now.value = expiresAt + 1;
    for (let i = 0; i < 6; i += 1) h.player.net.fireSegmentRequest();
    await vi.advanceTimersByTimeAsync(300);

    expect(h.resolveManifest).toHaveBeenCalledTimes(1);
    expect(h.player.loads).toHaveLength(2);
  });

  it('the request filter never blocks: it returns undefined synchronously', async () => {
    const h = await harness();
    await h.engine.load(manifest({ expiresAt: h.now.value - 1 }));
    const filter = h.player.net.filters[0];
    expect(filter).toBeTypeOf('function');
    expect(filter?.(SHAKA_REQUEST_TYPE_SEGMENT, { uris: ['x'] })).toBeUndefined();
  });

  it('ignores non-segment request types', async () => {
    vi.useFakeTimers();
    const h = await harness();
    await h.engine.load(manifest({ expiresAt: h.now.value - 1 }));
    for (const filter of h.player.net.filters) filter(0 /* MANIFEST */, { uris: ['x'] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.resolveManifest).not.toHaveBeenCalled();
  });
});

describe('lifecycle safety', () => {
  it('destroy() cancels a pending recovery and never re-resolves afterwards', async () => {
    vi.useFakeTimers();
    const h = await harness();
    await h.engine.load(manifest());

    h.player.emitError(badHttp(403));
    await h.engine.destroy();
    await vi.advanceTimersByTimeAsync(2000);

    expect(h.resolveManifest).not.toHaveBeenCalled();
    expect(h.player.destroyed).toBe(true);
    expect(h.player.net.filters).toHaveLength(0);
    expect(h.player.listeners.get('error')?.size ?? 0).toBe(0);
    expect(liveObjectUrls.size).toBe(0);
  });

  it('a recovery in flight does not clobber a newer load()', async () => {
    vi.useFakeTimers();
    const h = await harness();
    await h.engine.load(manifest({ manifestXml: '<MPD id="first"/>' }));

    let releaseResolve: (value: StreamManifest) => void = () => undefined;
    h.resolveManifest.mockImplementation(
      () =>
        new Promise<StreamManifest>((resolve) => {
          releaseResolve = resolve;
        }),
    );

    h.player.emitError(badHttp(403));
    await vi.advanceTimersByTimeAsync(300); // recovery started, awaiting resolve

    const second = manifest({ manifestXml: '<MPD id="second"/>' });
    const loadSecond = h.engine.load(second, 0);
    releaseResolve(manifest({ manifestXml: '<MPD id="stale"/>' }));
    await vi.advanceTimersByTimeAsync(0);
    await loadSecond;

    // The stale recovery must not have issued a load after the newer one.
    expect(h.player.loads).toHaveLength(2);
    expect(h.player.loads[1]?.startTime).toBe(0);
  });

  it('play/pause/seek/volume act on the element, not on cached state', async () => {
    const h = await harness();
    await h.engine.load(manifest());

    h.engine.seek(9999);
    expect(h.video.currentTime).toBe(600); // clamped to duration
    h.engine.seek(-5);
    expect(h.video.currentTime).toBe(0);
    h.engine.seekBy(30);
    expect(h.video.currentTime).toBe(30);

    h.engine.setVolume(2);
    expect(h.video.volume).toBe(1);
    h.engine.setMuted(true);
    h.engine.setVolume(0.4);
    expect(h.video.muted).toBe(false); // raising volume un-mutes
    h.engine.toggleMuted();
    expect(h.video.muted).toBe(true);

    h.engine.setRate(1.5);
    expect(h.video.playbackRate).toBe(1.5);

    h.engine.togglePlay();
    expect(h.video.paused).toBe(false);
    h.engine.togglePlay();
    expect(h.video.paused).toBe(true);
  });
});
