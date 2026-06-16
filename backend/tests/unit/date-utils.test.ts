import { describe, expect, it } from 'vitest';
import { toISOStringOrNull } from '../../src/utils/dates';

describe('date utils', () => {
  it('keeps provided string values instead of treating empty strings as null', () => {
    expect(toISOStringOrNull('')).toBe('');
    expect(toISOStringOrNull('2026-06-10T00:00:00.000Z')).toBe('2026-06-10T00:00:00.000Z');
  });

  it('returns null only for nullish values', () => {
    expect(toISOStringOrNull(null)).toBeNull();
    expect(toISOStringOrNull(undefined)).toBeNull();
  });
});
