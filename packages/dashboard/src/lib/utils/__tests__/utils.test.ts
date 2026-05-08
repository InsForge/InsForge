import { describe, it, expect } from 'vitest';
import { cn, isEmptyValue, compareVersions, formatTime, formatDate } from '#lib/utils/utils';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('handles conditional classes', () => {
    const isHidden = false;
    expect(cn('base', isHidden && 'hidden', 'end')).toBe('base end');
  });

  it('deduplicates tailwind classes', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2');
  });
});

describe('isEmptyValue', () => {
  it('returns true for null', () => {
    expect(isEmptyValue(null)).toBe(true);
  });

  it('returns true for undefined', () => {
    expect(isEmptyValue(undefined)).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isEmptyValue('')).toBe(false);
  });

  it('returns false for zero', () => {
    expect(isEmptyValue(0)).toBe(false);
  });

  it('returns false for false', () => {
    expect(isEmptyValue(false)).toBe(false);
  });
});

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('returns -1 when v1 < v2', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.1.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
  });

  it('returns 1 when v1 > v2', () => {
    expect(compareVersions('2.0.0', '1.0.0')).toBe(1);
  });

  it('handles v prefix', () => {
    expect(compareVersions('v1.0.0', 'v1.0.0')).toBe(0);
    expect(compareVersions('v2.0.0', '1.0.0')).toBe(1);
  });

  it('handles different length versions', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0', '1.0.1')).toBe(-1);
  });
});

describe('formatTime', () => {
  it('formats a valid ISO timestamp', () => {
    expect(formatTime('2025-01-15T15:30:00Z')).toContain('Jan 15, 2025');
  });

  it('returns original string for invalid timestamp', () => {
    expect(formatTime('not-a-date')).toBe('not-a-date');
  });
});

describe('formatDate', () => {
  it('formats a valid ISO timestamp to date only', () => {
    expect(formatDate('2025-01-15T15:30:00Z')).toBe('Jan 15, 2025');
  });

  it('returns original string for invalid timestamp', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});
