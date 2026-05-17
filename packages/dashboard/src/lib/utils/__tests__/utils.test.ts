import { ColumnType } from '@insforge/shared-schemas';
import { describe, expect, it } from 'vitest';
import {
  cn,
  compareVersions,
  convertValueForColumn,
  formatDate,
  formatTime,
  formatValueForDisplay,
  isEmptyValue,
} from '#lib/utils/utils';

describe('cn', () => {
  it('merges conditional classes and resolves Tailwind conflicts', () => {
    expect(cn('px-2', undefined, 'px-4', ['text-sm'])).toBe('px-4 text-sm');
  });
});

describe('isEmptyValue', () => {
  it('only treats null and undefined as empty database values', () => {
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue(undefined)).toBe(true);
    expect(isEmptyValue('')).toBe(false);
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue(false)).toBe(false);
  });
});

describe('compareVersions', () => {
  it('compares semantic versions with optional v prefix and missing segments', () => {
    expect(compareVersions('v2.1.0', '2.0.9')).toBe(1);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.3', '1.10.0')).toBe(-1);
  });
});

describe('formatTime', () => {
  it('formats valid ISO timestamps and preserves invalid input', () => {
    expect(formatTime('2026-05-17T12:30:00')).toBe('May 17, 2026, 12:30 PM');
    expect(formatTime('not-a-date')).toBe('not-a-date');
  });
});

describe('formatDate', () => {
  it('formats valid ISO dates and preserves invalid input', () => {
    expect(formatDate('2026-05-17T12:30:00')).toBe('May 17, 2026');
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

describe('formatValueForDisplay', () => {
  it('formats common database display values by column type', () => {
    expect(formatValueForDisplay(null)).toBe('null');
    expect(formatValueForDisplay(true, ColumnType.BOOLEAN)).toBe('True');
    expect(formatValueForDisplay('2026-05-17', ColumnType.DATE)).toBe('May 17, 2026');
    expect(formatValueForDisplay({ ok: true }, ColumnType.JSON)).toBe('{"ok":true}');
  });

  it('returns Invalid JSON for malformed JSON strings', () => {
    expect(formatValueForDisplay('{bad json', ColumnType.JSON)).toBe('Invalid JSON');
  });
});

describe('convertValueForColumn', () => {
  it('converts valid values and reports validation errors', () => {
    expect(convertValueForColumn(ColumnType.INTEGER, '42')).toEqual({ success: true, value: 42 });
    expect(convertValueForColumn(ColumnType.BOOLEAN, 'true')).toEqual({
      success: true,
      value: true,
    });
    expect(convertValueForColumn('unsupported', 'x')).toEqual({
      success: false,
      error: 'Unsupported column type: unsupported',
    });
    expect(convertValueForColumn(ColumnType.INTEGER, 'not-number').success).toBe(false);
  });
});
