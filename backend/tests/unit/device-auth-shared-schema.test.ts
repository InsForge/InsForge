import { describe, expect, it } from 'vitest';
import {
  approveDeviceAuthorizationRequestSchema,
  createDeviceAuthorizationRequestSchema,
  createDeviceAuthorizationResponseSchema,
  denyDeviceAuthorizationRequestSchema,
  exchangeDeviceAuthorizationRequestSchema,
} from '@insforge/shared-schemas';
import { deviceAuthorizationStatusSchema } from '@insforge/shared-schemas';

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
      deviceCode: 'secret-device-code',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://example.com/auth/device',
      verificationUriComplete: 'https://example.com/auth/device?user_code=ABCD-EFGH',
      expiresIn: 900,
      interval: 5,
    });

    expect(result.userCode).toBe('ABCD-EFGH');
  });

  it('rejects malformed user codes in device authorization responses', () => {
    expect(() =>
      createDeviceAuthorizationResponseSchema.parse({
        deviceCode: 'secret-device-code',
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
      deviceCode: 'secret-device-code',
      grantType: 'urn:insforge:params:oauth:grant-type:device_code',
    });

    expect(result.deviceCode).toBe('secret-device-code');
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
        deviceCode: 'secret-device-code',
        grantType: 'wrong-grant-type',
      })
    ).toThrow();
  });

  it('limits device authorization statuses to known values', () => {
    expect(deviceAuthorizationStatusSchema.parse('approved')).toBe('approved');
  });
});
