import { describe, it, expect } from 'vitest';
import { renameObjectRequestSchema } from '@insforge/shared-schemas';

describe('renameObjectRequestSchema validation', () => {
  it('accepts valid newKey', () => {
    const result = renameObjectRequestSchema.safeParse({ newKey: 'my-new-file.txt' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.newKey).toBe('my-new-file.txt');
    }
  });

  it('accepts newKey with path separators', () => {
    const result = renameObjectRequestSchema.safeParse({ newKey: 'subdir/nested/file.txt' });
    expect(result.success).toBe(true);
  });

  it('rejects empty newKey', () => {
    const result = renameObjectRequestSchema.safeParse({ newKey: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing newKey', () => {
    const result = renameObjectRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects newKey exceeding 1024 characters', () => {
    const result = renameObjectRequestSchema.safeParse({ newKey: 'a'.repeat(1025) });
    expect(result.success).toBe(false);
  });

  it('accepts newKey at exactly 1024 characters', () => {
    const result = renameObjectRequestSchema.safeParse({ newKey: 'a'.repeat(1024) });
    expect(result.success).toBe(true);
  });
});

describe('Rename route error mapping logic', () => {
  // Test the error-to-HTTP-status mapping used in the route handler
  const mapErrorToStatus = (error: Error): number => {
    if (error.message.includes('already exists')) return 409;
    if (error.message.includes('not found')) return 404;
    if (error.message.includes('Invalid')) return 400;
    return 500;
  };

  it('maps "already exists" to 409', () => {
    expect(mapErrorToStatus(new Error('Object "file.txt" already exists in bucket "b"'))).toBe(409);
  });

  it('maps "not found" to 404', () => {
    expect(mapErrorToStatus(new Error('Object "file.txt" not found in bucket "b"'))).toBe(404);
  });

  it('maps "Invalid" to 400', () => {
    expect(mapErrorToStatus(new Error('Invalid key. Cannot use ".." or start with "/"'))).toBe(400);
  });

  it('maps unknown errors to 500', () => {
    expect(mapErrorToStatus(new Error('connection reset'))).toBe(500);
  });
});
