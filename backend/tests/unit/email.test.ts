import { EmailService } from '../../src/core/email/email';
import { AppError } from '../../src/api/middleware/error';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import jwt from 'jsonwebtoken';

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
vi.mock('../../src/app.config', () => ({
  config: {
    app: {
      jwtSecret: 'test-jwt-secret',
    },
    cloud: {
      projectId: 'test-project-123',
      apiHost: 'https://api.test.com',
    },
  },
}));

describe('EmailService', () => {
  let emailService: EmailService;
  const oldEnv = process.env;

  beforeEach(async () => {
    // Reset all mocks
    vi.resetAllMocks();

    // Mock config values
    const { config } = await import('../../src/app.config');
    config.cloud.projectId = 'test-project-123';
    config.app.jwtSecret = 'test-jwt-secret';
    config.cloud.apiHost = 'https://api.test.com';

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
        { magic_link: 'https://example.com/verify?token=abc123' }
      );

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          template: 'email-verification-link',
          variables: { magic_link: 'https://example.com/verify?token=abc123' },
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
        magic_link: 'https://example.com/reset?token=xyz789',
      });

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          template: 'reset-password-link',
          variables: { magic_link: 'https://example.com/reset?token=xyz789' },
        }),
        expect.any(Object)
      );
    });

    it('throws error if PROJECT_ID is not configured', async () => {
      const { config } = await import('../../src/app.config');
      config.cloud.projectId = 'local';

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
      config.cloud.projectId = 'test-project-123';
    });

    it('throws error if JWT_SECRET is not configured', async () => {
      const { config } = await import('../../src/app.config');
      config.app.jwtSecret = '';

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
      config.app.jwtSecret = 'test-jwt-secret';
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
});
