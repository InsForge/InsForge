import { describe, it, expect, afterEach } from 'vitest';
import { getMaxFileSize } from '../../src/api/middlewares/upload';

const DEFAULT_50MB = 50 * 1024 * 1024;

describe('getMaxFileSize', () => {
  const originalEnv = process.env.MAX_FILE_SIZE;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MAX_FILE_SIZE;
    } else {
      process.env.MAX_FILE_SIZE = originalEnv;
    }
  });

  it('returns 50MB default when env var is not set', () => {
    delete process.env.MAX_FILE_SIZE;
    expect(getMaxFileSize()).toBe(DEFAULT_50MB);
  });

  it('returns 50MB default when env var is empty string', () => {
    process.env.MAX_FILE_SIZE = '';
    expect(getMaxFileSize()).toBe(DEFAULT_50MB);
  });

  it('returns custom value when env var is set', () => {
    process.env.MAX_FILE_SIZE = '10485760'; // 10MB
    expect(getMaxFileSize()).toBe(10485760);
  });

  it('returns default for non-numeric env var', () => {
    process.env.MAX_FILE_SIZE = 'not-a-number';
    expect(getMaxFileSize()).toBe(DEFAULT_50MB);
  });
});
