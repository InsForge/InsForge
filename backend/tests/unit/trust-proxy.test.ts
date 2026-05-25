import { describe, expect, it } from 'vitest';
import { parseTrustProxySetting } from '../../src/utils/trust-proxy';

describe('parseTrustProxySetting', () => {
  it('keeps the existing two-hop default for backwards compatibility', () => {
    expect(parseTrustProxySetting(undefined)).toBe(2);
    expect(parseTrustProxySetting('')).toBe(2);
  });

  it('parses explicit boolean values', () => {
    expect(parseTrustProxySetting('true')).toBe(true);
    expect(parseTrustProxySetting('FALSE')).toBe(false);
  });

  it('parses explicit proxy hop counts', () => {
    expect(parseTrustProxySetting('0')).toBe(0);
    expect(parseTrustProxySetting('1')).toBe(1);
    expect(parseTrustProxySetting('3')).toBe(3);
  });

  it('passes through Express named or subnet trust proxy values', () => {
    expect(parseTrustProxySetting('loopback')).toBe('loopback');
    expect(parseTrustProxySetting('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8');
  });

  it('trims whitespace before parsing scalar values', () => {
    expect(parseTrustProxySetting(' 2 ')).toBe(2);
    expect(parseTrustProxySetting(' true ')).toBe(true);
  });

  it('rejects finite non-integer numeric values instead of passing them to Express', () => {
    expect(() => parseTrustProxySetting('1.5')).toThrow(/non-negative integer/);
    expect(() => parseTrustProxySetting('-1')).toThrow(/non-negative integer/);
  });
});
