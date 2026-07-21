import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPool, mockClient, mockAppConfig } = vi.hoisted(() => ({
  mockPool: {
    connect: vi.fn(),
  },
  mockClient: {
    query: vi.fn(),
    release: vi.fn(),
  },
  mockAppConfig: {
    app: { jwtSecret: 'test-secret' },
    cloud: { projectId: undefined as string | undefined },
  },
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

vi.mock('../../src/infra/config/app.config', () => ({
  appConfig: mockAppConfig,
}));

vi.mock('../../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { SmtpConfigService } from '../../src/services/email/smtp-config.service';

const disabledInput = {
  enabled: false,
  host: '',
  port: 465,
  username: '',
  senderEmail: '',
  senderName: '',
  minIntervalSeconds: 60,
};

const disabledRow = {
  id: 'b04553ba-5572-4012-a157-3d8dce0f7938',
  enabled: false,
  host: '',
  port: 465,
  username: '',
  password_encrypted: 'encrypted-password',
  senderEmail: '',
  senderName: '',
  minIntervalSeconds: 60,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('SmtpConfigService email verification invariant', () => {
  let service: SmtpConfigService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAppConfig.cloud.projectId = undefined;
    mockPool.connect.mockResolvedValue(mockClient);
    Reflect.set(SmtpConfigService, 'instance', undefined);
    service = SmtpConfigService.getInstance();
  });

  it('rejects disabling the only provider while email verification is required', async () => {
    mockClient.query.mockImplementation(async (query: string) => {
      if (query.includes('SELECT id, password_encrypted FROM email.config')) {
        return {
          rows: [
            {
              id: 'b04553ba-5572-4012-a157-3d8dce0f7938',
              password_encrypted: 'encrypted-password',
            },
          ],
        };
      }
      if (query.includes('require_email_verification')) {
        return { rows: [{ require_email_verification: true }] };
      }
      if (query.includes('UPDATE email.config')) {
        return { rows: [disabledRow] };
      }
      return { rows: [] };
    });

    await expect(service.upsertSmtpConfig(disabledInput)).rejects.toMatchObject({
      statusCode: 400,
      code: 'EMAIL_PROVIDER_NOT_CONFIGURED',
    });

    expect(
      mockClient.query.mock.calls.some(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('UPDATE email.config')
      )
    ).toBe(false);
  });

  it('allows disabling SMTP when the managed cloud provider is available', async () => {
    mockAppConfig.cloud.projectId = 'cloud-project-id';
    mockClient.query.mockImplementation(async (query: string) => {
      if (query.includes('SELECT id, password_encrypted FROM email.config')) {
        return {
          rows: [
            {
              id: 'b04553ba-5572-4012-a157-3d8dce0f7938',
              password_encrypted: 'encrypted-password',
            },
          ],
        };
      }
      if (query.includes('UPDATE email.config')) {
        return { rows: [disabledRow] };
      }
      return { rows: [] };
    });

    const result = await service.upsertSmtpConfig(disabledInput);

    expect(result.enabled).toBe(false);
  });

  it('allows disabling SMTP when email verification is not required', async () => {
    mockClient.query.mockImplementation(async (query: string) => {
      if (query.includes('SELECT id, password_encrypted FROM email.config')) {
        return {
          rows: [
            {
              id: 'b04553ba-5572-4012-a157-3d8dce0f7938',
              password_encrypted: 'encrypted-password',
            },
          ],
        };
      }
      if (query.includes('require_email_verification')) {
        return { rows: [{ require_email_verification: false }] };
      }
      if (query.includes('UPDATE email.config')) {
        return { rows: [disabledRow] };
      }
      return { rows: [] };
    });

    const result = await service.upsertSmtpConfig(disabledInput);

    expect(result.enabled).toBe(false);
  });
});
