import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  countryName,
  flagEmoji,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  truncateId,
  webOverviewLabel,
  webOverviewValue,
} from '#features/analytics/lib/format';

describe('analytics format helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats country codes', () => {
    expect(flagEmoji('us')).toBe('🇺🇸');
    expect(flagEmoji('USA')).toBe('');
    expect(countryName('us')).toBe('United States');
    expect(countryName('')).toBe('');
  });

  it('formats numeric analytics values', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3661)).toBe('1:01:01');
    expect(formatDuration(-1)).toBe('0:00');
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatPercent(1.24, { signed: true })).toBe('+1.2%');
    expect(formatPercent(-1.24, { signed: true })).toBe('-1.2%');
  });

  it('formats relative and compact labels', () => {
    expect(formatRelativeTime('2026-05-17T11:58:00.000Z')).toBe('2m ago');
    expect(truncateId('019ddbc3-272e-4567', 12)).toBe('019ddbc3-272…');
    expect(webOverviewLabel('bounce_rate')).toBe('Bounce rate');
    expect(webOverviewLabel('custom_key')).toBe('custom key');
  });

  it('formats web overview values by metric key', () => {
    expect(webOverviewValue('visitors', 1234)).toBe('1,234');
    expect(webOverviewValue('bounce_rate', 42.4)).toBe('42%');
    expect(webOverviewValue('session_duration', 125)).toBe('2:05');
    expect(webOverviewValue('visitors', null)).toBe('—');
  });
});
