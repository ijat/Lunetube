import { describe, expect, it } from 'vitest';
import { describeOverlay } from '../PlayerSurface.js';

/**
 * `describeOverlay` is the pure decision function behind the player's status
 * overlay. The `status === 'error'` branch (F2) is the one that matters: a
 * fatal shaka failure must surface a message and a Retry button rather than
 * freezing the video with nothing on screen.
 */

const base = {
  degraded: false,
  reason: null,
  status: 'ready',
  isPending: false,
  hasError: false,
  errorMessage: null,
} as const;

describe('describeOverlay', () => {
  it('renders nothing while playing normally', () => {
    expect(describeOverlay({ ...base })).toBeNull();
  });

  it('surfaces a fatal playback error with a retry affordance', () => {
    const overlay = describeOverlay({ ...base, status: 'error' });
    expect(overlay).toEqual({ text: 'This video could not be played.', canRetry: true });
  });

  it('prefers the degraded reason over a bare error status', () => {
    const overlay = describeOverlay({
      ...base,
      status: 'error',
      degraded: true,
      reason: 'Stream URLs expired and could not be renewed.',
    });
    expect(overlay?.text).toBe('Stream URLs expired and could not be renewed.');
  });

  it('prefers the query error message over a bare error status', () => {
    const overlay = describeOverlay({
      ...base,
      status: 'error',
      hasError: true,
      errorMessage: 'yt:streams failed',
    });
    expect(overlay?.text).toBe('yt:streams failed');
  });

  it('shows the recovering and loading states', () => {
    expect(describeOverlay({ ...base, status: 'recovering' })?.text).toBe('Renewing stream…');
    expect(describeOverlay({ ...base, status: 'loading' })?.canRetry).toBe(false);
    expect(describeOverlay({ ...base, isPending: true })?.text).toBe('Loading…');
  });
});
