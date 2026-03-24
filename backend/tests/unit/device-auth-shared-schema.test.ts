import { describe, expect, it } from 'vitest';
import {
  approveDeviceAuthorizationRequestSchema,
  createDeviceAuthorizationRequestSchema,
  createDeviceAuthorizationResponseSchema,
  denyDeviceAuthorizationRequestSchema,
  exchangeDeviceAuthorizationRequestSchema,
  exchangeDeviceAuthorizationSuccessResponseSchema,
} from '@insforge/shared-schemas';
import { deviceAuthorizationStatusSchema } from '@insforge/shared-schemas';

const DEVICE_CODE = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('device auth shared schemas', () => {
  it('accepts device authorization creation payloads', () => {
    const result = createDeviceAuthorizationRequestSchema.parse({
      deviceName: 'my-vps',
      hostname: 'vps-01',
      platform: 'linux-x64',
    });

    expect(result).toEqual({
      deviceName: 'my-vps',
      hostname: 'vps-01',
      platform: 'linux-x64',
    });
  });

  it('allows an empty device authorization creation payload', () => {
    expect(createDeviceAuthorizationRequestSchema.parse({})).toEqual({});
  });

  it('accepts device authorization creation responses', () => {
    const result = createDeviceAuthorizationResponseSchema.parse({
      deviceCode: DEVICE_CODE,
      userCode: 'ABCDE-FGHIJ',
      verificationUri: 'https://example.com/auth/device',
      verificationUriComplete: 'https://example.com/auth/device?user_code=ABCDE-FGHIJ',
      expiresIn: 900,
      interval: 5,
    });

    expect(result.userCode).toBe('ABCDE-FGHIJ');
  });

  it('rejects malformed user codes in device authorization responses', () => {
    expect(() =>
      createDeviceAuthorizationResponseSchema.parse({
        deviceCode: DEVICE_CODE,
        userCode: 'bad-code',
        verificationUri: 'https://example.com/auth/device',
        verificationUriComplete: 'https://example.com/auth/device?user_code=bad-code',
        expiresIn: 900,
        interval: 5,
      })
    ).toThrow();
  });

  it('accepts device authorization exchange payloads', () => {
    const result = exchangeDeviceAuthorizationRequestSchema.parse({
      deviceCode: DEVICE_CODE,
      grantType: 'urn:ietf:params:oauth:grant-type:device_code',
    });

    expect(result.deviceCode).toBe(DEVICE_CODE);
  });

  it('rejects malformed user codes in approve or deny payloads', () => {
    expect(() =>
      approveDeviceAuthorizationRequestSchema.parse({
        userCode: 'bad-code',
      })
    ).toThrow();

    expect(() =>
      denyDeviceAuthorizationRequestSchema.parse({
        userCode: 'bad-code',
      })
    ).toThrow();
  });

  it('rejects invalid grant types in device authorization exchange payloads', () => {
    expect(() =>
      exchangeDeviceAuthorizationRequestSchema.parse({
        deviceCode: DEVICE_CODE,
        grantType: 'wrong-grant-type',
      })
    ).toThrow();
  });

  it('rejects malformed device codes in exchange payloads', () => {
    expect(() =>
      exchangeDeviceAuthorizationRequestSchema.parse({
        deviceCode: 'secret-device-code',
        grantType: 'urn:ietf:params:oauth:grant-type:device_code',
      })
    ).toThrow();
  });

  it('requires refreshToken in the device authorization exchange response', () => {
    expect(() =>
      exchangeDeviceAuthorizationSuccessResponseSchema.parse({
        accessToken: 'access-token-123',
        user: {
          id: '11111111-1111-1111-1111-111111111111',
          email: 'user@example.com',
          emailVerified: true,
          createdAt: '2026-03-24T00:00:00.000Z',
          updatedAt: '2026-03-24T00:00:00.000Z',
          profile: null,
          metadata: null,
        },
      })
    ).toThrow();
  });

  it('limits device authorization statuses to known values', () => {
    expect(deviceAuthorizationStatusSchema.parse('approved')).toBe('approved');
  });
});
