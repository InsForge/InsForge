import { describe, expect, it } from 'vitest';
import { idTokenSignInRequestSchema, oAuthConfigSchema } from '@insforge/shared-schemas';

describe('idTokenSignInRequestSchema', () => {
  it('keeps the existing Google request compatible', () => {
    expect(
      idTokenSignInRequestSchema.safeParse({ provider: 'google', token: 'google-token' }).success
    ).toBe(true);
  });

  it('accepts an Apple token, nonce, and first-authorization name', () => {
    const result = idTokenSignInRequestSchema.safeParse({
      provider: 'apple',
      token: 'apple-token',
      nonce: 'native-nonce',
      name: 'Apple User',
    });

    expect(result.success).toBe(true);
  });

  it('requires a nonce for Apple requests', () => {
    expect(
      idTokenSignInRequestSchema.safeParse({ provider: 'apple', token: 'apple-token' }).success
    ).toBe(false);
  });

  it('preserves the exact raw Apple nonce while rejecting whitespace-only values', () => {
    const result = idTokenSignInRequestSchema.safeParse({
      provider: 'apple',
      token: 'apple-token',
      nonce: '  native-nonce  ',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nonce).toBe('  native-nonce  ');
    }
    expect(
      idTokenSignInRequestSchema.safeParse({
        provider: 'apple',
        token: 'apple-token',
        nonce: '   ',
      }).success
    ).toBe(false);
  });

  it('rejects a caller-selected Apple audience', () => {
    expect(
      idTokenSignInRequestSchema.safeParse({
        provider: 'apple',
        token: 'apple-token',
        nonce: 'native-nonce',
        audience: 'com.attacker.app',
      }).success
    ).toBe(false);
  });

  it('bounds optional first-authorization names', () => {
    expect(
      idTokenSignInRequestSchema.safeParse({
        provider: 'apple',
        token: 'apple-token',
        nonce: 'native-nonce',
        name: 'a'.repeat(101),
      }).success
    ).toBe(false);
  });

  it('validates project-owned native client ID configuration', () => {
    const result = oAuthConfigSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000001',
      provider: 'apple',
      clientId: 'com.example.web',
      nativeClientIds: ['com.example.ios'],
      useSharedKey: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result.success).toBe(true);
  });
});
