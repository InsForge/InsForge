import { describe, expect, it } from 'vitest';
import { sendSignInOTPRequestSchema, signInWithOTPRequestSchema } from '@insforge/shared-schemas';

describe('email OTP sign-in schemas', () => {
  it('normalizes email addresses for OTP requests', () => {
    const result = sendSignInOTPRequestSchema.parse({
      email: 'USER@Example.com',
    });

    expect(result).toEqual({ email: 'user@example.com' });
  });

  it('accepts a six-digit OTP and optional first-time profile name', () => {
    const result = signInWithOTPRequestSchema.parse({
      email: 'USER@Example.com',
      otp: '123456',
      name: '  Ada Lovelace  ',
    });

    expect(result).toEqual({
      email: 'user@example.com',
      otp: '123456',
      name: 'Ada Lovelace',
    });
  });

  it('rejects non-numeric or incorrectly sized OTP values', () => {
    expect(
      signInWithOTPRequestSchema.safeParse({
        email: 'user@example.com',
        otp: '12345',
      }).success
    ).toBe(false);
    expect(
      signInWithOTPRequestSchema.safeParse({
        email: 'user@example.com',
        otp: '12345a',
      }).success
    ).toBe(false);
  });
});
