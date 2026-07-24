import { describe, expect, it } from 'vitest';
import { createSessionRequestSchema, sendOTPRequestSchema } from '@insforge/shared-schemas';

describe('email OTP sign-in schemas', () => {
  it('normalizes email addresses for OTP requests', () => {
    const result = sendOTPRequestSchema.parse({
      email: 'USER@Example.com',
    });

    expect(result).toEqual({ email: 'user@example.com' });
  });

  it('accepts a six-digit OTP and optional first-time profile name', () => {
    const result = createSessionRequestSchema.parse({
      method: 'otp',
      email: 'USER@Example.com',
      otp: '123456',
      name: '  Ada Lovelace  ',
    });

    expect(result).toEqual({
      method: 'otp',
      email: 'user@example.com',
      otp: '123456',
      name: 'Ada Lovelace',
    });
  });

  it('rejects non-numeric or incorrectly sized OTP values', () => {
    expect(
      createSessionRequestSchema.safeParse({
        method: 'otp',
        email: 'user@example.com',
        otp: '12345',
      }).success
    ).toBe(false);
    expect(
      createSessionRequestSchema.safeParse({
        method: 'otp',
        email: 'user@example.com',
        otp: '12345a',
      }).success
    ).toBe(false);
  });

  it('keeps existing password session requests backward compatible', () => {
    const result = createSessionRequestSchema.parse({
      email: 'USER@Example.com',
      password: 'securepassword123',
    });

    expect(result).toEqual({
      email: 'user@example.com',
      password: 'securepassword123',
    });
  });

  it('accepts an explicit password method', () => {
    const result = createSessionRequestSchema.parse({
      method: 'password',
      email: 'user@example.com',
      password: 'securepassword123',
    });

    expect(result.method).toBe('password');
  });
});
