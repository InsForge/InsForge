import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET = 'test-secret';

const mocks = vi.hoisted(() => ({
  pool: {
    connect: vi.fn(),
    query: vi.fn(),
  },
  client: {
    query: vi.fn(),
    release: vi.fn(),
  },
  verifyCredentials: vi.fn(),
}));

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mocks.pool,
    }),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/providers/sms/twilio.provider.js', () => ({
  TwilioSmsProvider: class {
    verifyCredentials = mocks.verifyCredentials;
  },
}));

import { SmsConfigService } from '../../src/services/sms/sms-config.service.js';
import { EncryptionManager } from '../../src/infra/security/encryption.manager.js';

const ROW_ID = '44444444-4444-4444-8444-444444444444';

function upsertQueryImplementation(stored: { auth_token_encrypted: string }) {
  return (sql: string, params?: unknown[]) => {
    if (sql.includes('pg_advisory_xact_lock') || sql === 'BEGIN' || sql === 'COMMIT') {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes('FOR UPDATE')) {
      return Promise.resolve({
        rows: [{ id: ROW_ID, auth_token_encrypted: stored.auth_token_encrypted }],
      });
    }
    if (sql.includes('UPDATE sms.config')) {
      stored.auth_token_encrypted = params?.[3] as string;
      return Promise.resolve({
        rows: [
          {
            id: ROW_ID,
            enabled: params?.[0],
            provider: params?.[1],
            accountSid: params?.[2],
            auth_token_encrypted: params?.[3],
            fromNumber: params?.[4],
            messagingServiceSid: params?.[5],
            minIntervalSeconds: params?.[6],
            otpMessageTemplate: params?.[7],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      });
    }
    return Promise.resolve({ rows: [] });
  };
}

describe('SmsConfigService', () => {
  let service: SmsConfigService;

  beforeEach(() => {
    vi.clearAllMocks();
    Reflect.set(SmsConfigService, 'instance', undefined);
    mocks.pool.connect.mockResolvedValue(mocks.client);
    mocks.verifyCredentials.mockResolvedValue(undefined);
    service = SmsConfigService.getInstance();
  });

  it('encrypts the auth token at rest and never returns it', async () => {
    const stored = { auth_token_encrypted: '' };
    mocks.client.query.mockImplementation(upsertQueryImplementation(stored));

    const result = await service.upsertSmsConfig({
      enabled: true,
      provider: 'twilio',
      accountSid: 'ACtest',
      authToken: 'plain-secret',
      fromNumber: '+15550001111',
      messagingServiceSid: '',
      minIntervalSeconds: 60,
    });

    expect(stored.auth_token_encrypted).not.toContain('plain-secret');
    expect(EncryptionManager.decrypt(stored.auth_token_encrypted)).toBe('plain-secret');
    expect(result).not.toHaveProperty('authToken');
    expect(result.hasAuthToken).toBe(true);
  });

  it('keeps the stored ciphertext when the auth token is omitted', async () => {
    const existing = EncryptionManager.encrypt('already-stored');
    const stored = { auth_token_encrypted: existing };
    mocks.client.query.mockImplementation(upsertQueryImplementation(stored));

    await service.upsertSmsConfig({
      enabled: true,
      provider: 'twilio',
      accountSid: 'ACtest',
      fromNumber: '+15550001111',
      messagingServiceSid: '',
      minIntervalSeconds: 60,
    });

    expect(stored.auth_token_encrypted).toBe(existing);
    // The credential check used the stored token, not an empty string.
    expect(mocks.verifyCredentials).toHaveBeenCalledWith('ACtest', 'already-stored');
  });

  it('verifies Twilio credentials before persisting an enabled config', async () => {
    const stored = { auth_token_encrypted: '' };
    mocks.client.query.mockImplementation(upsertQueryImplementation(stored));
    mocks.verifyCredentials.mockRejectedValue(new Error('Twilio connection failed'));

    await expect(
      service.upsertSmsConfig({
        enabled: true,
        provider: 'twilio',
        accountSid: 'ACtest',
        authToken: 'bad',
        fromNumber: '+15550001111',
        messagingServiceSid: '',
        minIntervalSeconds: 60,
      })
    ).rejects.toThrow();

    expect(
      mocks.client.query.mock.calls.some(
        ([sql]) => typeof sql === 'string' && sql.includes('UPDATE sms.config')
      )
    ).toBe(false);
  });

  it('skips the credential check when disabling', async () => {
    const stored = { auth_token_encrypted: '' };
    mocks.client.query.mockImplementation(upsertQueryImplementation(stored));

    await service.upsertSmsConfig({
      enabled: false,
      provider: 'twilio',
      accountSid: '',
      fromNumber: '',
      messagingServiceSid: '',
      minIntervalSeconds: 60,
    });

    expect(mocks.verifyCredentials).not.toHaveBeenCalled();
  });

  it('rejects enabling the console provider in production', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const stored = { auth_token_encrypted: '' };
      mocks.client.query.mockImplementation(upsertQueryImplementation(stored));

      await expect(
        service.upsertSmsConfig({
          enabled: true,
          provider: 'console',
          accountSid: '',
          fromNumber: '',
          messagingServiceSid: '',
          minIntervalSeconds: 60,
        })
      ).rejects.toMatchObject({ statusCode: 400 });
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('masks the auth token as hasAuthToken on read', async () => {
    mocks.pool.query.mockResolvedValue({
      rows: [
        {
          id: ROW_ID,
          enabled: true,
          provider: 'twilio',
          accountSid: 'ACtest',
          auth_token_encrypted: EncryptionManager.encrypt('secret'),
          fromNumber: '+15550001111',
          messagingServiceSid: '',
          minIntervalSeconds: 60,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const config = await service.getSmsConfig();

    expect(config.hasAuthToken).toBe(true);
    expect(JSON.stringify(config)).not.toContain('secret');
  });

  it('treats a disabled row as unconfigured for sending', async () => {
    mocks.pool.query.mockResolvedValue({
      rows: [
        {
          id: ROW_ID,
          enabled: false,
          provider: 'twilio',
          accountSid: 'ACtest',
          auth_token_encrypted: EncryptionManager.encrypt('secret'),
          fromNumber: '+15550001111',
          messagingServiceSid: '',
          minIntervalSeconds: 60,
        },
      ],
    });

    expect(await service.getRawSmsConfig()).toBeNull();
  });

  it('treats undecryptable credentials as unconfigured for sending', async () => {
    mocks.pool.query.mockResolvedValue({
      rows: [
        {
          id: ROW_ID,
          enabled: true,
          provider: 'twilio',
          accountSid: 'ACtest',
          auth_token_encrypted: 'corrupted-ciphertext',
          fromNumber: '+15550001111',
          messagingServiceSid: '',
          minIntervalSeconds: 60,
        },
      ],
    });

    expect(await service.getRawSmsConfig()).toBeNull();
  });

  it('returns decrypted credentials for an enabled twilio config', async () => {
    mocks.pool.query.mockResolvedValue({
      rows: [
        {
          id: ROW_ID,
          enabled: true,
          provider: 'twilio',
          accountSid: 'ACtest',
          auth_token_encrypted: EncryptionManager.encrypt('secret'),
          fromNumber: '+15550001111',
          messagingServiceSid: '',
          minIntervalSeconds: 60,
        },
      ],
    });

    const raw = await service.getRawSmsConfig();

    expect(raw).toMatchObject({ provider: 'twilio', authToken: 'secret' });
  });

  it('does not require credentials for the console provider', async () => {
    mocks.pool.query.mockResolvedValue({
      rows: [
        {
          id: ROW_ID,
          enabled: true,
          provider: 'console',
          accountSid: '',
          auth_token_encrypted: '',
          fromNumber: '',
          messagingServiceSid: '',
          minIntervalSeconds: 60,
        },
      ],
    });

    const raw = await service.getRawSmsConfig();

    expect(raw).toMatchObject({ provider: 'console', authToken: '' });
  });
});
