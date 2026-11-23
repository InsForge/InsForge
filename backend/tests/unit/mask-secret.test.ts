import { describe, it, expect } from 'vitest';
import { maskSecret } from '../../src/utils/mask.js';

describe('maskSecret', () => {
  it('keeps the key prefix and last 4 characters only', () => {
    expect(maskSecret('ik_0123456789abcdefghij')).toBe('ik_****ghij');
    expect(maskSecret('anon_0123456789abcdefghij')).toBe('anon_****ghij');
    expect(maskSecret('eyJhbGciOiJIUzI1NiJ9.payload.sig')).toBe('eyJ****.sig');
  });

  it('fully masks short or missing values', () => {
    expect(maskSecret('ik_short')).toBe('****');
    expect(maskSecret('')).toBe('****');
    expect(maskSecret(undefined)).toBe('****');
    expect(maskSecret(null)).toBe('****');
  });

  it('never includes the bulk of the secret', () => {
    const key = 'ik_' + 'x'.repeat(40);
    expect(maskSecret(key)).not.toContain('x'.repeat(8));
  });
});
