import { useCallback, useRef, useState } from 'react';
import { formatDuration } from '@lunetube/shared';
import { usePlayerStore } from '../usePlayerStore.js';

export interface TimelineProps {
  onSeek: (seconds: number) => void;
}

const KEY_STEP = 5;

/**
 * The mockup's `.timeline` (docs/mockups.html L337–357): a 4px track with a
 * buffered band, an accent fill that carries `box-shadow: 0 0 14px var(--glow)`,
 * a 13px head with a 4px glow ring, and a hover preview bubble.
 *
 * The `<video>` element stays authoritative: dragging seeks the element and the
 * rAF mirror feeds the position back. There is no local "scrub position" state
 * that could disagree with reality — the only local state is the *hover*
 * position, which the element has no opinion about.
 *
 * The bubble's thumbnail slot is deliberately empty. Storyboard previews come
 * from `StreamManifest.storyboards[]` (P1-3 — **not** from shaka; the generated
 * manifest has no image AdaptationSets) and are wired in Phase 4.
 */
export function Timeline({ onSeek }: TimelineProps) {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const bufferedEnd = usePlayerStore((s) => s.bufferedEnd);

  const trackRef = useRef<HTMLDivElement>(null);
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);
  const draggingRef = useRef(false);

  const fractionAt = useCallback((clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  const seekToClientX = useCallback(
    (clientX: number): void => {
      if (duration <= 0) return;
      onSeek(fractionAt(clientX) * duration);
    },
    [duration, fractionAt, onSeek],
  );

  const played = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const buffered = duration > 0 ? Math.min(1, bufferedEnd / duration) : 0;
  const hoverTime = hoverFraction === null ? 0 : hoverFraction * duration;

  return (
    <div
      className="player__timeline"
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, Math.round(duration))}
      aria-valuenow={Math.round(currentTime)}
      aria-valuetext={`${formatDuration(currentTime)} of ${formatDuration(duration)}`}
      data-testid="player-timeline"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        draggingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        seekToClientX(event.clientX);
      }}
      onPointerMove={(event) => {
        setHoverFraction(fractionAt(event.clientX));
        if (draggingRef.current) seekToClientX(event.clientX);
      }}
      onPointerUp={(event) => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        draggingRef.current = false;
      }}
      onPointerLeave={() => setHoverFraction(null)}
      onKeyDown={(event) => {
        // The global shortcut hook yields the arrows to `role="slider"`, so the
        // timeline owns them while focused.
        if (event.key === 'ArrowLeft') onSeek(currentTime - KEY_STEP);
        else if (event.key === 'ArrowRight') onSeek(currentTime + KEY_STEP);
        else if (event.key === 'Home') onSeek(0);
        else if (event.key === 'End') onSeek(duration);
        else return;
        event.preventDefault();
      }}
    >
      <div className="player__track" ref={trackRef}>
        <div className="player__track-buf" style={{ width: `${buffered * 100}%` }} />
        <div className="player__track-play" style={{ width: `${played * 100}%` }} />
      </div>
      <div className="player__head" style={{ left: `${played * 100}%` }} />
      {hoverFraction !== null && duration > 0 && (
        <div className="player__bubble" style={{ left: `${hoverFraction * 100}%` }}>
          {/* Phase-4 seam: storyboard tile from StreamManifest.storyboards[]. */}
          <div className="player__bubble-thumb" />
          <div className="player__bubble-time tnum">{formatDuration(hoverTime)}</div>
        </div>
      )}
    </div>
  );
}
