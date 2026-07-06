import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { getExportFilename } from '#lib/utils/data-export';

describe('Data Export Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
  describe('getExportFilename', () => {
    test('returns base name when timestamp is false', () => {
      const filename = getExportFilename('my_export', { timestamp: false });
      expect(filename).toBe('my_export');
    });

    test('appends timestamp to filename by default', () => {
      const filename = getExportFilename('my_export');
      // Should match pattern: basename_YYYY-MM-DD_HH-MM-SS
      expect(filename).toMatch(/^my_export_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
    });

    test('appends timestamp when explicitly set to true', () => {
      const filename = getExportFilename('query_results', { timestamp: true });
      expect(filename).toMatch(/^query_results_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
    });

    test('contains date in YYYY-MM-DD format', () => {
      const filename = getExportFilename('export', { timestamp: true });
      const datePart = filename.split('_')[1];
      expect(datePart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('contains time in HH-MM-SS format', () => {
      const filename = getExportFilename('export', { timestamp: true });
      const timePart = filename.split('_')[2];
      expect(timePart).toMatch(/^\d{2}-\d{2}-\d{2}$/);
    });

    test('handles base names with underscores', () => {
      const filename = getExportFilename('query_results_export', { timestamp: false });
      expect(filename).toBe('query_results_export');
    });

    test('handles different base names', () => {
      const filename1 = getExportFilename('data', { timestamp: false });
      const filename2 = getExportFilename('export', { timestamp: false });
      expect(filename1).toBe('data');
      expect(filename2).toBe('export');
    });

    test('generates different timestamps for different times', () => {
      const filename1 = getExportFilename('export', { timestamp: true });
      // Wait a bit and get another filename
      const filename2 = getExportFilename('export', { timestamp: true });
      // Both should have timestamps but might be the same if called quickly
      expect(filename1).toMatch(/^export_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
      expect(filename2).toMatch(/^export_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
    });
  });
});
