import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResendEmailProvider } from '../../src/providers/email/resend.provider';
import { AppError } from '../../src/api/middlewares/error';

const sendMock = vi.fn().mockResolvedValue({ data: { id: 'test-email-id' }, error: null });

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  })),
}));

vi.mock('../../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

const mockResendConfig = {
  id: '00000000-0000-0000-0000-000000000001',
  enabled: true,
  apiKey: 're_test_api_key_123',
  senderEmail: 'noreply@example.com',
  senderName: 'Test App',
};

const mockTemplate = {
  id: '00000000-0000-0000-0000-000000000001',
  templateType: 'email-verification-code',
  subject: 'Verify your email',
  bodyHtml: '<p>Your code is: {{ code }}</p><p>Email: {{ email }}</p>',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const getRawResendConfigMock = vi.fn().mockResolvedValue(mockResendConfig);
const getTemplateMock = vi.fn().mockResolvedValue(mockTemplate);

vi.mock('../../src/services/email/resend-config.service', () => ({
  ResendConfigService: {
    getInstance: () => ({
      getRawResendConfig: getRawResendConfigMock,
    }),
  },
}));

vi.mock('../../src/services/email/email-template.service', () => ({
  EmailTemplateService: {
    getInstance: () => ({
      getTemplate: getTemplateMock,
    }),
  },
}));

describe('ResendEmailProvider', () => {
  let provider: ResendEmailProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    sendMock.mockResolvedValue({ data: { id: 'test-email-id' }, error: null });
    getRawResendConfigMock.mockResolvedValue(mockResendConfig);
    getTemplateMock.mockResolvedValue(mockTemplate);
    provider = new ResendEmailProvider();
  });

  describe('supportsTemplates', () => {
    it('returns true', () => {
      expect(provider.supportsTemplates()).toBe(true);
    });
  });

  describe('sendWithTemplate', () => {
    it('sends email with rendered template via Resend API', async () => {
      await provider.sendWithTemplate('user@example.com', 'Test User', 'email-verification-code', {
        code: '123456',
      });

      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'Test App <noreply@example.com>',
          to: ['user@example.com'],
          subject: 'Verify your email',
          html: expect.stringContaining('123456'),
        })
      );
    });

    it('HTML-escapes placeholder values to prevent XSS', async () => {
      await provider.sendWithTemplate(
        '<script>alert("xss")</script>@evil.com',
        'Test User',
        'email-verification-code',
        { code: '<img src=x onerror=alert(1)>' }
      );

      const callArgs = sendMock.mock.calls[0][0];
      expect(callArgs.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(callArgs.html).toContain('&lt;script&gt;');
      expect(callArgs.html).not.toContain('<script>');
    });

    it('throws AppError when Resend is not configured', async () => {
      getRawResendConfigMock.mockResolvedValueOnce(null);

      await expect(
        provider.sendWithTemplate('user@example.com', 'App', 'email-verification-code', {
          code: '123456',
        })
      ).rejects.toThrow(AppError);
    });

    it('throws AppError when Resend API returns error', async () => {
      sendMock.mockResolvedValueOnce({
        data: null,
        error: { message: 'Invalid API key', name: 'validation_error' },
      });

      await expect(
        provider.sendWithTemplate('user@example.com', 'App', 'email-verification-code', {
          code: '123456',
        })
      ).rejects.toThrow(AppError);
    });
  });

  describe('sendRaw', () => {
    it('sends raw email via Resend API', async () => {
      await provider.sendRaw({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        html: '<p>Hello</p>',
      });

      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'Test App <noreply@example.com>',
          to: ['recipient@example.com'],
          subject: 'Test Subject',
          html: '<p>Hello</p>',
        })
      );
    });

    it('passes through cc, bcc, and replyTo', async () => {
      await provider.sendRaw({
        to: 'recipient@example.com',
        subject: 'Test',
        html: '<p>Hi</p>',
        cc: 'cc@example.com',
        bcc: 'bcc@example.com',
        replyTo: 'reply@example.com',
      });

      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          cc: ['cc@example.com'],
          bcc: ['bcc@example.com'],
          replyTo: 'reply@example.com',
        })
      );
    });

    it('handles array recipients', async () => {
      await provider.sendRaw({
        to: ['a@example.com', 'b@example.com'],
        subject: 'Test',
        html: '<p>Hi</p>',
      });

      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ['a@example.com', 'b@example.com'],
        })
      );
    });

    it('throws AppError when Resend is not configured', async () => {
      getRawResendConfigMock.mockResolvedValueOnce(null);

      await expect(
        provider.sendRaw({
          to: 'user@example.com',
          subject: 'Test',
          html: '<p>Hi</p>',
        })
      ).rejects.toThrow(AppError);
    });
  });
});
