import { EmailService } from '../../src/services/email/email.service';
import { AppError } from '../../src/utils/errors';
import { describe, it, expect, beforeEach, afterEach, vi, afterAll } from 'vitest';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { SmtpConfigService } from '../../src/services/email/smtp-config.service';
import { SmtpEmailProvider } from '../../src/providers/email/smtp.provider';
import { CloudEmailProvider } from '../../src/providers/email/cloud.provider';
import { ERROR_CODES } from '@insforge/shared-schemas';

// Mock dependencies
vi.mock('axios');
vi.mock('jsonwebtoken');
vi.mock('../../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));
vi.mock('../../src/infra/config/app.config', () => {
  const c = {
    app: {
      jwtSecret: 'test-jwt-secret',
    },
    cloud: {
      projectId: 'test-project-123',
      apiHost: 'https://api.test.com',
    },
  };
  return {
    config: c,
    appConfig: c,
  };
});

// isCloudProject() needs our infrastructure marker as well as a project id.
const savedProfile = process.env.AWS_INSTANCE_PROFILE_NAME;

beforeEach(() => {
  process.env.AWS_INSTANCE_PROFILE_NAME = 'EC2-role';
});

afterAll(() => {
  if (savedProfile === undefined) {
    delete process.env.AWS_INSTANCE_PROFILE_NAME;
  } else {
    process.env.AWS_INSTANCE_PROFILE_NAME = savedProfile;
  }
});

describe('EmailService', () => {
  let emailService: EmailService;
  const oldEnv = process.env;

  beforeEach(async () => {
    // Reset all mocks
    vi.resetAllMocks();

    // Mock config values
    const { appConfig } = await import('../../src/infra/config/app.config');
    appConfig.cloud.projectId = 'test-project-123';
    appConfig.app.jwtSecret = 'test-jwt-secret';
    appConfig.cloud.apiHost = 'https://api.test.com';

    // Get fresh instance
    emailService = EmailService.getInstance();

    // Default mock for jwt.sign
    (jwt.sign as unknown as ReturnType<typeof vi.fn>).mockReturnValue('mocked-jwt-token');
  });

  afterEach(() => {
    process.env = oldEnv;
  });

  describe('getInstance', () => {
    it('returns singleton instance', () => {
      const instance1 = EmailService.getInstance();
      const instance2 = EmailService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('sendWithTemplate', () => {
    it('successfully sends email with verification code template', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { success: true },
      });

      await emailService.sendWithTemplate(
        'user@example.com',
        'John Doe',
        'email-verification-code',
        { token: '123456' }
      );

      expect(jwt.sign).toHaveBeenCalledWith({ sub: 'test-project-123' }, 'test-jwt-secret', {
        expiresIn: '10m',
      });

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.test.com/email/v1/test-project-123/send-with-template',
        {
          email: 'user@example.com',
          name: 'John Doe',
          template: 'email-verification-code',
          variables: { token: '123456' },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            sign: 'mocked-jwt-token',
          },
          timeout: 10000,
        }
      );
    });

    it('successfully sends email with verification link template', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { success: true },
      });

      await emailService.sendWithTemplate(
        'user@example.com',
        'John Doe',
        'email-verification-link',
        { link: 'https://example.com/verify?token=abc123' }
      );

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          template: 'email-verification-link',
          variables: { link: 'https://example.com/verify?token=abc123' },
        }),
        expect.any(Object)
      );
    });

    it('successfully sends email with reset-password code template', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { success: true },
      });

      await emailService.sendWithTemplate('user@example.com', 'Jane Smith', 'reset-password-code', {
        token: 'reset123',
      });

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          template: 'reset-password-code',
          variables: { token: 'reset123' },
        }),
        expect.any(Object)
      );
    });

    it('successfully sends email with reset-password link template', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { success: true },
      });

      await emailService.sendWithTemplate('user@example.com', 'Jane Smith', 'reset-password-link', {
        link: 'https://example.com/reset?token=xyz789',
      });

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          template: 'reset-password-link',
          variables: { link: 'https://example.com/reset?token=xyz789' },
        }),
        expect.any(Object)
      );
    });

    it('throws error if PROJECT_ID is not configured', async () => {
      const { appConfig } = await import('../../src/infra/config/app.config');
      appConfig.cloud.projectId = 'local';

      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', 'email-verification-code', {
          token: '123456',
        })
      ).rejects.toThrow(AppError);

      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', 'email-verification-code', {
          token: '123456',
        })
      ).rejects.toThrow('PROJECT_ID is not configured');

      // Reset for other tests
      appConfig.cloud.projectId = 'test-project-123';
    });

    it('throws error if JWT_SECRET is not configured', async () => {
      const { appConfig } = await import('../../src/infra/config/app.config');
      appConfig.app.jwtSecret = '';

      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', 'email-verification-code', {
          token: '123456',
        })
      ).rejects.toThrow(AppError);

      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', 'email-verification-code', {
          token: '123456',
        })
      ).rejects.toThrow('JWT_SECRET is not configured');

      // Reset for other tests
      appConfig.app.jwtSecret = 'test-jwt-secret';
    });

    it('throws error if required parameters are missing', async () => {
      await expect(
        emailService.sendWithTemplate('', 'John', 'email-verification-code')
      ).rejects.toThrow('Missing required parameters');

      await expect(
        emailService.sendWithTemplate('user@example.com', '', 'email-verification-code')
      ).rejects.toThrow('Missing required parameters');
    });

    it('throws error for invalid template type', async () => {
      await expect(
        emailService.sendWithTemplate(
          'user@example.com',
          'John',
          '123456',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'invalid-template' as any
        )
      ).rejects.toThrow('Invalid template type');
    });

    it('throws error if cloud service returns unsuccessful response', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { success: false },
      });

      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', 'email-verification-code', {
          token: '123456',
        })
      ).rejects.toThrow('Email service returned unsuccessful response');
    });

    it('handles 401 authentication error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error = new Error('Request failed') as any;
      error.isAxiosError = true;
      error.response = {
        status: 401,
        data: { message: 'Unauthorized' },
      };

      vi.mocked(axios.post).mockRejectedValue(error);
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', 'email-verification-code', {
          token: '123456',
        })
      ).rejects.toThrow('Authentication failed with cloud email service');
    });

    it('handles 403 forbidden error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error = new Error('Request failed') as any;
      error.isAxiosError = true;
      error.response = {
        status: 403,
        data: { message: 'Forbidden' },
      };

      vi.mocked(axios.post).mockRejectedValue(error);
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', 'email-verification-code', {
          token: '123456',
        })
      ).rejects.toThrow('Authentication failed with cloud email service');
    });

    it('handles 429 rate limit error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error = new Error('Request failed') as any;
      error.isAxiosError = true;
      error.response = {
        status: 429,
        data: { message: 'Too many requests' },
      };

      vi.mocked(axios.post).mockRejectedValue(error);
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', 'email-verification-code', {
          token: '123456',
        })
      ).rejects.toThrow('Email rate limit exceeded');
    });

    it('handles 400 bad request error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error = new Error('Request failed') as any;
      error.isAxiosError = true;
      error.response = {
        status: 400,
        data: { message: 'Invalid email format' },
      };

      vi.mocked(axios.post).mockRejectedValue(error);
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', 'email-verification-code', {
          token: '123456',
        })
      ).rejects.toThrow('Invalid email request: Invalid email format');
    });

    it('handles generic axios error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error = new Error('Request failed') as any;
      error.isAxiosError = true;
      error.response = {
        status: 500,
        data: { message: 'Internal server error' },
      };

      vi.mocked(axios.post).mockRejectedValue(error);
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', 'email-verification-code', {
          token: '123456',
        })
      ).rejects.toThrow('Failed to send email: Internal server error');
    });

    it('handles network error without response', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error = new Error('Network error') as any;
      error.isAxiosError = true;

      vi.mocked(axios.post).mockRejectedValue(error);
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', 'email-verification-code', {
          token: '123456',
        })
      ).rejects.toThrow('Failed to send email: Network error');
    });

    it('handles non-axios error', async () => {
      vi.mocked(axios.post).mockRejectedValue(new Error('Unexpected error'));

      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', 'email-verification-code', {
          token: '123456',
        })
      ).rejects.toThrow('Failed to send email: Unexpected error');
    });
  });

  describe('JWT token generation', () => {
    it('generates JWT with correct payload and expiration', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { success: true },
      });

      await emailService.sendWithTemplate(
        'user@example.com',
        'John Doe',
        'email-verification-code',
        {
          token: '123456',
        }
      );

      expect(jwt.sign).toHaveBeenCalledWith({ sub: 'test-project-123' }, 'test-jwt-secret', {
        expiresIn: '10m',
      });
    });
  });

  // A self-host with a PROJECT_ID and no SMTP used to reach the cloud signer and fail
  // against our API. Naming the missing SMTP config is the actionable version.
  it('reports missing SMTP rather than reaching the cloud signer off-cloud', async () => {
    delete process.env.AWS_INSTANCE_PROFILE_NAME;
    const { appConfig } = await import('../../src/infra/config/app.config');
    appConfig.cloud.projectId = 'zeabur-project-1';

    await expect(
      emailService.sendWithTemplate('user@example.com', 'John', 'email-verification-code', {
        token: '123456',
      })
    ).rejects.toThrow('No email provider is configured');
  });

  describe('Rate limiting and recipient normalization', () => {
    const mockSmtpConfig = {
      id: 'smtp-1',
      enabled: true,
      host: 'smtp.example.com',
      port: 587,
      username: 'user',
      password: 'password',
      senderEmail: 'noreply@example.com',
      senderName: 'Test',
      minIntervalSeconds: 60,
    };

    beforeEach(() => {
      vi.spyOn(SmtpConfigService.getInstance(), 'getRawSmtpConfig').mockResolvedValue(
        mockSmtpConfig
      );
      vi.spyOn(SmtpEmailProvider.prototype, 'sendWithTemplate').mockResolvedValue();
    });

    it('enforces min interval rate limit case-insensitively and with trimmed whitespace', async () => {
      // First email to user@example.com succeeds
      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', 'email-verification-code', {
          token: '123456',
        })
      ).resolves.toBeUndefined();

      // Second email immediately to differently-cased address should be rate-limited
      await expect(
        emailService.sendWithTemplate('USER@example.com', 'John', 'email-verification-code', {
          token: '123456',
        })
      ).rejects.toThrow(/Too many emails to this address/);

      // Whitespace variation should also be rate-limited
      await expect(
        emailService.sendWithTemplate('  User@example.com  ', 'John', 'email-verification-code', {
          token: '123456',
        })
      ).rejects.toThrow(/Too many emails to this address/);

      // Email to a different recipient should succeed
      await expect(
        emailService.sendWithTemplate('other@example.com', 'Alice', 'email-verification-code', {
          token: '654321',
        })
      ).resolves.toBeUndefined();
    });

    it('throws AppError when email provider does not support raw email sending', async () => {
      vi.spyOn(SmtpConfigService.getInstance(), 'getRawSmtpConfig').mockResolvedValue(null);
      const originalSendRaw = CloudEmailProvider.prototype.sendRaw;
      // Temporarily remove sendRaw from prototype to test provider capability check
      delete (CloudEmailProvider.prototype as { sendRaw?: unknown }).sendRaw;

      try {
        const err = await emailService
          .sendRaw({
            to: 'user@example.com',
            subject: 'Test Raw Email',
            html: '<p>Hello</p>',
          })
          .then(
            () => null,
            (e: unknown) => e
          );

        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
        expect((err as AppError).code).toBe(ERROR_CODES.INVALID_INPUT);
        expect((err as AppError).message).toContain(
          'Current email provider does not support raw email sending'
        );
      } finally {
        CloudEmailProvider.prototype.sendRaw = originalSendRaw;
      }
    });
  });
});
