import { formatDuration } from '@lunetube/shared';
import { usePlayerStore } from '../usePlayerStore.js';

/**
 * The mockup's `.ctl .time`, with F5 conflict 1 resolved in favour of the PRD:
 * **Hanken Grotesk + `tabular-nums`, not IBM Plex Mono.** `.tnum` comes from
 * `@lunetube/design`'s typography tokens; `--font-body` is inherited.
 */
export function TimeDisplay() {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);

  return (
    <span className="player__time tnum" data-testid="player-time">
      {formatDuration(currentTime)}
      {' / '}
      {formatDuration(duration)}
    </span>
  );
}
