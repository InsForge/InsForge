import { describe, test, expect } from 'vitest';

/**
 * Tests for the pagination parameter clamping logic used across routes.
 *
 * The pattern `Math.max(0, parseInt(value) || default)` ensures that:
 * - Negative values are clamped to 0 (offset) or 1 (limit)
 * - NaN values (non-numeric strings) fall back to the default
 * - Valid positive values pass through unchanged
 *
 * This prevents PostgreSQL from rejecting negative LIMIT/OFFSET values
 * with a 500 error.
 */

// Helper that mirrors the offset clamping pattern used in routes
const clampOffset = (raw: string): number => Math.max(0, parseInt(raw) || 0);

// Helper that mirrors the limit clamping pattern used in routes
const clampLimit = (raw: string, defaultLimit: number): number =>
  Math.max(1, parseInt(raw) || defaultLimit);

describe('Pagination parameter clamping', () => {
  describe('offset clamping', () => {
    test('negative offset is clamped to 0', () => {
      expect(clampOffset('-1')).toBe(0);
      expect(clampOffset('-100')).toBe(0);
      expect(clampOffset('-999999')).toBe(0);
    });

    test('zero offset passes through', () => {
      expect(clampOffset('0')).toBe(0);
    });

    test('positive offset passes through', () => {
      expect(clampOffset('10')).toBe(10);
      expect(clampOffset('50')).toBe(50);
    });

    test('non-numeric string falls back to 0', () => {
      expect(clampOffset('abc')).toBe(0);
      expect(clampOffset('')).toBe(0);
    });
  });

  describe('limit clamping', () => {
    test('negative limit is clamped to 1', () => {
      expect(clampLimit('-1', 50)).toBe(1);
      expect(clampLimit('-5', 50)).toBe(1);
      expect(clampLimit('-100', 50)).toBe(1);
    });

    test('zero limit falls back to default (0 is falsy in JS)', () => {
      expect(clampLimit('0', 50)).toBe(50);
    });

    test('positive limit passes through', () => {
      expect(clampLimit('10', 50)).toBe(10);
      expect(clampLimit('100', 50)).toBe(100);
    });

    test('non-numeric string falls back to default', () => {
      expect(clampLimit('abc', 50)).toBe(50);
      expect(clampLimit('', 50)).toBe(50);
      expect(clampLimit('abc', 100)).toBe(100);
    });
  });
});
