import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any imports
// ---------------------------------------------------------------------------
const { sendMailMock, getRawSmtpConfigMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn().mockResolvedValue({ messageId: 'test-id' }),
  getRawSmtpConfigMock: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn().mockReturnValue({
      sendMail: sendMailMock,
      close: vi.fn(),
    }),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/services/email/smtp-config.service', () => ({
  SmtpConfigService: {
    getInstance: () => ({
      getRawSmtpConfig: getRawSmtpConfigMock,
    }),
  },
}));

vi.mock('../../src/services/email/email-template.service', () => ({
  EmailTemplateService: {
    getInstance: () => ({
      getTemplate: vi.fn().mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000001',
        templateType: 'email-verification-link',
        subject: 'Verify your email',
        bodyHtml: '<a href="{{ link }}">Click here</a>',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }),
    }),
  },
}));

import { SmtpEmailProvider } from '../../src/providers/email/smtp.provider';

describe('SmtpEmailProvider — link URL validation', () => {
  let provider: SmtpEmailProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    getRawSmtpConfigMock.mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000001',
      enabled: true,
      host: 'smtp.example.com',
      port: 465,
      username: 'testuser',
      password: 'testpass',
      senderEmail: 'noreply@example.com',
      senderName: 'Test App',
      minIntervalSeconds: 60,
    });
    provider = new SmtpEmailProvider();
  });

  it('allows https:// links in templates', async () => {
    await provider.sendWithTemplate('user@example.com', 'App', 'email-verification-link', {
      link: 'https://example.com/verify?token=abc123',
    });

    const html = sendMailMock.mock.calls[0][0].html;
    expect(html).toContain('href="https://example.com/verify?token=abc123"');
  });

  it('allows http:// links in templates', async () => {
    await provider.sendWithTemplate('user@example.com', 'App', 'email-verification-link', {
      link: 'http://localhost:3000/verify?token=abc123',
    });

    const html = sendMailMock.mock.calls[0][0].html;
    expect(html).toContain('href="http://localhost:3000/verify?token=abc123"');
  });

  it('rejects javascript: URIs and renders # instead', async () => {
    await provider.sendWithTemplate('user@example.com', 'App', 'email-verification-link', {
      link: 'javascript:alert(document.cookie)',
    });

    const html = sendMailMock.mock.calls[0][0].html;
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="#"');
  });

  it('rejects data: URIs and renders # instead', async () => {
    await provider.sendWithTemplate('user@example.com', 'App', 'email-verification-link', {
      link: 'data:text/html,<script>alert(1)</script>',
    });

    const html = sendMailMock.mock.calls[0][0].html;
    expect(html).not.toContain('data:');
    expect(html).toContain('href="#"');
  });

  it('rejects empty string links and renders # instead', async () => {
    await provider.sendWithTemplate('user@example.com', 'App', 'email-verification-link', {
      link: '',
    });

    const html = sendMailMock.mock.calls[0][0].html;
    expect(html).toContain('href="#"');
  });

  it('rejects vbscript: URIs and renders # instead', async () => {
    await provider.sendWithTemplate('user@example.com', 'App', 'email-verification-link', {
      link: 'vbscript:MsgBox("XSS")',
    });

    const html = sendMailMock.mock.calls[0][0].html;
    expect(html).not.toContain('vbscript:');
    expect(html).toContain('href="#"');
  });
});
