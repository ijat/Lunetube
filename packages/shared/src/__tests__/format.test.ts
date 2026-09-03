import { describe, expect, it } from 'vitest';
import {
  formatCompactCount,
  formatDuration,
  formatRelativeDate,
  parseTimestampsFromText,
} from '../format.js';

describe('formatDuration', () => {
  it('formats sub-minute durations with a zero minute field', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(11)).toBe('0:11');
    expect(formatDuration(42)).toBe('0:42');
  });

  it('formats minutes:seconds below one hour', () => {
    expect(formatDuration(62)).toBe('1:02');
    expect(formatDuration(184)).toBe('3:04');
    expect(formatDuration(3599)).toBe('59:59');
  });

  it('rolls into an hours field at 3600s and never shows a bare 62:03', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3723)).toBe('1:02:03');
    expect(formatDuration(3723)).not.toBe('62:03');
  });

  it('handles durations longer than 24 hours', () => {
    expect(formatDuration(90_061)).toBe('25:01:01');
    expect(formatDuration(11_051)).toBe('3:04:11');
  });

  it('clamps non-finite and negative input to zero and floors fractions', () => {
    expect(formatDuration(-5)).toBe('0:00');
    expect(formatDuration(Number.NaN)).toBe('0:00');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0:00');
    expect(formatDuration(42.9)).toBe('0:42');
  });
});

describe('formatCompactCount', () => {
  it('passes small numbers through', () => {
    expect(formatCompactCount(0)).toBe('0');
    expect(formatCompactCount(999)).toBe('999');
  });

  it('abbreviates thousands, millions and billions', () => {
    expect(formatCompactCount(1000)).toBe('1K');
    expect(formatCompactCount(1234)).toBe('1.2K');
    expect(formatCompactCount(1_234_567)).toBe('1.2M');
    expect(formatCompactCount(1_000_000_000)).toBe('1B');
  });

  it('handles negatives and non-finite input', () => {
    expect(formatCompactCount(-5)).toBe('-5');
    expect(formatCompactCount(Number.NaN)).toBe('0');
  });
});

describe('formatRelativeDate', () => {
  const now = new Date('2026-09-03T12:00:00Z');

  it('formats recent and distant past', () => {
    expect(formatRelativeDate(new Date('2026-09-03T11:55:00Z'), now)).toBe('5 minutes ago');
    expect(formatRelativeDate(new Date('2026-09-01T12:00:00Z'), now)).toBe('2 days ago');
    expect(formatRelativeDate(new Date('2023-09-03T12:00:00Z'), now)).toBe('3 years ago');
  });

  it('accepts epoch-ms and ISO string input', () => {
    expect(formatRelativeDate(now.getTime() - 7_200_000, now)).toBe('2 hours ago');
    expect(formatRelativeDate('2026-09-03T09:00:00Z', now)).toBe('3 hours ago');
  });

  it('returns an empty string for invalid input', () => {
    expect(formatRelativeDate('not a date', now)).toBe('');
  });
});

describe('parseTimestampsFromText', () => {
  it('extracts m:ss and h:mm:ss timestamps with correct offsets and seconds', () => {
    const text = 'Chapters:\n0:00 Intro\n1:23 Part two\n1:02:03 End';
    const found = parseTimestampsFromText(text);
    expect(found).toHaveLength(3);
    expect(found[0]).toEqual({ index: text.indexOf('0:00'), length: 4, seconds: 0 });
    expect(found[1]?.seconds).toBe(83);
    expect(found[2]).toEqual({ index: text.indexOf('1:02:03'), length: 7, seconds: 3723 });
  });

  it('returns an empty array when there are no timestamps', () => {
    expect(parseTimestampsFromText('no timecodes here, just prose')).toEqual([]);
  });

  it('does not match numbers embedded in words or ratios', () => {
    expect(parseTimestampsFromText('a4:20b')).toEqual([]);
  });
});
