import { describe, expect, it } from 'vitest';
import {
  createSessionRequestSchema,
  sendPhoneOTPRequestSchema,
  upsertSmsConfigRequestSchema,
} from '@insforge/shared-schemas';

describe('phone OTP sign-in schemas', () => {
  it('accepts a valid E.164 phone number, trimming whitespace', () => {
    const result = sendPhoneOTPRequestSchema.parse({
      phone: '  +15551234567  ',
    });

    expect(result).toEqual({ phone: '+15551234567' });
  });

  it.each([
    ['missing plus prefix', '15551234567'],
    ['letters', '+1555abc4567'],
    ['leading zero after plus', '+05551234567'],
    ['too short', '+123456'],
    ['too long', '+1234567890123456'],
    ['interior whitespace', '+1 555 123 4567'],
    ['dashes', '+1-555-123-4567'],
    ['empty', ''],
  ])('rejects %s', (_label, phone) => {
    expect(sendPhoneOTPRequestSchema.safeParse({ phone }).success).toBe(false);
  });

  it('accepts a six-digit OTP session keyed on phone with an optional name', () => {
    const result = createSessionRequestSchema.parse({
      method: 'otp',
      phone: '+15551234567',
      otp: '123456',
      name: '  Ada Lovelace  ',
    });

    expect(result).toEqual({
      method: 'otp',
      phone: '+15551234567',
      otp: '123456',
      name: 'Ada Lovelace',
    });
  });

  it('rejects an OTP session providing both email and phone', () => {
    const result = createSessionRequestSchema.safeParse({
      method: 'otp',
      email: 'user@example.com',
      phone: '+15551234567',
      otp: '123456',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({ message: 'Provide exactly one of email or phone' }),
      ]);
    }
  });

  it('reports a missing identifier as an email requirement for compatibility', () => {
    const result = createSessionRequestSchema.safeParse({ method: 'otp', otp: '123456' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({ path: ['email'], message: 'Required' }),
      ]);
    }
  });

  it('rejects a malformed phone number on the session request', () => {
    expect(
      createSessionRequestSchema.safeParse({
        method: 'otp',
        phone: '5551234567',
        otp: '123456',
      }).success
    ).toBe(false);
  });

  it('tolerates clients that serialize the unused identifier as null', () => {
    const emailResult = createSessionRequestSchema.parse({
      method: 'otp',
      email: 'user@example.com',
      phone: null,
      otp: '123456',
    });
    expect(emailResult).toEqual({ method: 'otp', email: 'user@example.com', otp: '123456' });

    const phoneResult = createSessionRequestSchema.parse({
      method: 'otp',
      email: null,
      phone: '+15551234567',
      otp: '123456',
    });
    expect(phoneResult).toEqual({ method: 'otp', phone: '+15551234567', otp: '123456' });
  });
});

describe('SMS config schemas', () => {
  it('allows saving a disabled config without provider fields', () => {
    const result = upsertSmsConfigRequestSchema.parse({ enabled: false });

    expect(result).toMatchObject({
      enabled: false,
      provider: 'twilio',
      accountSid: '',
      fromNumber: '',
      messagingServiceSid: '',
      minIntervalSeconds: 60,
    });
  });

  it('requires an account SID and a sender when enabling twilio', () => {
    const result = upsertSmsConfigRequestSchema.safeParse({ enabled: true });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('accountSid');
      expect(paths).toContain('fromNumber');
    }
  });

  it('accepts a messaging service SID in place of a from number', () => {
    const result = upsertSmsConfigRequestSchema.safeParse({
      enabled: true,
      accountSid: `AC${'a'.repeat(32)}`,
      authToken: 'token',
      messagingServiceSid: `MG${'b'.repeat(32)}`,
    });

    expect(result.success).toBe(true);
  });

  it('rejects a from number that is not E.164', () => {
    const result = upsertSmsConfigRequestSchema.safeParse({
      enabled: true,
      accountSid: `AC${'a'.repeat(32)}`,
      authToken: 'token',
      fromNumber: '555-1234',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a malformed account SID', () => {
    const result = upsertSmsConfigRequestSchema.safeParse({
      enabled: true,
      accountSid: 'ACtest',
      authToken: 'token',
      fromNumber: '+15550001111',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([expect.objectContaining({ path: ['accountSid'] })]);
    }
  });

  it('rejects an API key SID pasted into the messaging service SID field', () => {
    const result = upsertSmsConfigRequestSchema.safeParse({
      enabled: true,
      accountSid: `AC${'a'.repeat(32)}`,
      authToken: 'token',
      messagingServiceSid: `SK${'c'.repeat(32)}`,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({ path: ['messagingServiceSid'] }),
      ]);
    }
  });

  it('skips twilio field requirements for the console provider', () => {
    const result = upsertSmsConfigRequestSchema.safeParse({
      enabled: true,
      provider: 'console',
    });

    expect(result.success).toBe(true);
  });

  it('rejects an empty auth token so omission is the only keep-stored signal', () => {
    expect(
      upsertSmsConfigRequestSchema.safeParse({
        enabled: true,
        accountSid: `AC${'a'.repeat(32)}`,
        authToken: '',
        fromNumber: '+15551234567',
      }).success
    ).toBe(false);
  });

  it('applies the default OTP message template', () => {
    const result = upsertSmsConfigRequestSchema.parse({ enabled: false });

    expect(result.otpMessageTemplate).toBe(
      'Your verification code is {{ code }}. It expires in 5 minutes.'
    );
  });

  it('rejects an enabled config whose template lacks the code placeholder', () => {
    const result = upsertSmsConfigRequestSchema.safeParse({
      enabled: true,
      provider: 'console',
      otpMessageTemplate: 'Welcome! Please sign in.',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({ path: ['otpMessageTemplate'] }),
      ]);
    }
  });
});
