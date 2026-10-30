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
      method: 'password',
      email: 'user@example.com',
      password: 'securepassword123',
    });
  });

  it('treats a null or undefined method as the legacy password flow', () => {
    for (const method of [null, undefined]) {
      const result = createSessionRequestSchema.parse({
        method,
        email: 'user@example.com',
        password: 'securepassword123',
      });

      expect(result).toMatchObject({ method: 'password', email: 'user@example.com' });
    }
  });

  it('accepts an explicit password method', () => {
    const result = createSessionRequestSchema.parse({
      method: 'password',
      email: 'user@example.com',
      password: 'securepassword123',
    });

    expect(result.method).toBe('password');
  });

  it('preserves field-level errors for legacy password requests', () => {
    const result = createSessionRequestSchema.safeParse({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({ path: ['email'], message: 'Required' }),
        expect.objectContaining({ path: ['password'], message: 'Required' }),
      ]);
    }
  });

  it('returns OTP field errors for an incomplete OTP request', () => {
    const result = createSessionRequestSchema.safeParse({ method: 'otp' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({ path: ['email'], message: 'Required' }),
        expect.objectContaining({ path: ['otp'], message: 'Required' }),
      ]);
    }
  });

  it('rejects unknown session methods at the discriminator', () => {
    const result = createSessionRequestSchema.safeParse({ method: 'magic' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({
          path: ['method'],
          message: "Invalid discriminator value. Expected 'password' | 'otp'",
        }),
      ]);
    }
  });
});
