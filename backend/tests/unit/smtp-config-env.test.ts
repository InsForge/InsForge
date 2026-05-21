import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => ({
        query: mockQuery,
      }),
    }),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { SmtpConfigService } from '../../src/services/email/smtp-config.service';

const emptyConfigRow = {
  id: 'config-id',
  enabled: false,
  host: '',
  port: 465,
  username: '',
  password_encrypted: '',
  senderEmail: '',
  senderName: '',
  minIntervalSeconds: 60,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('SmtpConfigService environment fallback', () => {
  const oldEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...oldEnv };
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USERNAME;
    delete process.env.SMTP_PASSWORD;
    delete process.env.SMTP_SENDER_EMAIL;
    delete process.env.SMTP_SENDER_NAME;
    delete process.env.SMTP_MIN_INTERVAL_SECONDS;
  });

  afterEach(() => {
    process.env = oldEnv;
  });

  it('uses SMTP_* environment variables when the stored config is empty and disabled', async () => {
    process.env.SMTP_HOST = 'mailpit';
    process.env.SMTP_PORT = '1025';
    process.env.SMTP_SENDER_EMAIL = 'noreply@insforge.local';
    process.env.SMTP_SENDER_NAME = 'InsForge Local';
    process.env.SMTP_MIN_INTERVAL_SECONDS = '0';
    mockQuery.mockResolvedValueOnce({ rows: [emptyConfigRow] });

    const config = await SmtpConfigService.getInstance().getRawSmtpConfig();

    expect(config).toEqual({
      id: 'env-smtp',
      enabled: true,
      host: 'mailpit',
      port: 1025,
      username: '',
      password: '',
      senderEmail: 'noreply@insforge.local',
      senderName: 'InsForge Local',
      minIntervalSeconds: 0,
    });
  });

  it('exposes the active environment SMTP config to settings reads', async () => {
    process.env.SMTP_HOST = 'mailpit';
    process.env.SMTP_PORT = '1025';
    process.env.SMTP_SENDER_EMAIL = 'noreply@insforge.local';
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const config = await SmtpConfigService.getInstance().getSmtpConfig();

    expect(config).toMatchObject({
      id: 'env-smtp',
      enabled: true,
      host: 'mailpit',
      port: 1025,
      username: '',
      hasPassword: false,
      senderEmail: 'noreply@insforge.local',
      senderName: 'InsForge',
      minIntervalSeconds: 60,
    });
  });

  it('does not override a user-disabled stored SMTP config', async () => {
    process.env.SMTP_HOST = 'mailpit';
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          ...emptyConfigRow,
          host: 'smtp.example.com',
          senderEmail: 'noreply@example.com',
        },
      ],
    });

    await expect(SmtpConfigService.getInstance().getRawSmtpConfig()).resolves.toBeNull();
  });

  it('still shows a user-disabled stored config in settings reads', async () => {
    process.env.SMTP_HOST = 'mailpit';
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          ...emptyConfigRow,
          host: 'smtp.example.com',
          senderEmail: 'noreply@example.com',
        },
      ],
    });

    await expect(SmtpConfigService.getInstance().getSmtpConfig()).resolves.toMatchObject({
      enabled: false,
      host: 'smtp.example.com',
      senderEmail: 'noreply@example.com',
    });
  });
});
