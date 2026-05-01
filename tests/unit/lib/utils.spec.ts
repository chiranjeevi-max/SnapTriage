import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatRelativeTime } from '../../../src/lib/utils';

describe('formatRelativeTime', () => {
  beforeEach(() => {
    // Mock the current time to ensure tests are deterministic
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('handles null date', () => {
    expect(formatRelativeTime(null)).toBe('Never');
  });

  it('handles invalid date', () => {
    expect(formatRelativeTime('invalid-date')).toBe('Never');
  });

  it('handles very recent times (< 1 min)', () => {
    const recent = new Date('2024-01-01T11:59:30.000Z').toISOString();
    expect(formatRelativeTime(recent)).toBe('now');
  });

  it('handles minutes', () => {
    const minutesAgo = new Date('2024-01-01T11:55:00.000Z').toISOString();
    expect(formatRelativeTime(minutesAgo)).toBe('5m');
  });

  it('handles hours', () => {
    const hoursAgo = new Date('2024-01-01T09:00:00.000Z').toISOString();
    expect(formatRelativeTime(hoursAgo)).toBe('3h');
  });

  it('handles days', () => {
    const daysAgo = new Date('2023-12-29T12:00:00.000Z').toISOString();
    expect(formatRelativeTime(daysAgo)).toBe('3d');
  });

  it('handles months', () => {
    const monthsAgo = new Date('2023-10-01T12:00:00.000Z').toISOString();
    expect(formatRelativeTime(monthsAgo)).toBe('3mo'); // Roughly 92 days / 30 = 3 months
  });

  describe('options', () => {
    it('appends suffix when option is true', () => {
      const minutesAgo = new Date('2024-01-01T11:55:00.000Z').toISOString();
      expect(formatRelativeTime(minutesAgo, { suffix: true })).toBe('5m ago');
    });

    it('uses custom nowLabel', () => {
      const recent = new Date('2024-01-01T11:59:30.000Z').toISOString();
      expect(formatRelativeTime(recent, { nowLabel: 'just now' })).toBe('just now');
    });
  });

  it('handles future dates as "now"', () => {
    const future = new Date('2024-01-01T12:05:00.000Z').toISOString();
    // A future date means diffMs is negative, diffMins < 1 is true
    expect(formatRelativeTime(future)).toBe('now');
  });
});
