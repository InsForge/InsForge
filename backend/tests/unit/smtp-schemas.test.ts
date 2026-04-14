import { describe, it, expect } from 'vitest';
import {
  upsertSmtpConfigRequestSchema,
  updateEmailTemplateRequestSchema,
  smtpConfigSchema,
  emailTemplateSchema,
} from '@insforge/shared-schemas';

describe('SMTP Config Request Schema', () => {
  it('accepts valid SMTP config', () => {
    const result = upsertSmtpConfigRequestSchema.safeParse({
      enabled: true,
      host: 'smtp.gmail.com',
      port: 465,
      username: 'user@gmail.com',
      password: 'app-password',
      senderEmail: 'noreply@myapp.com',
      senderName: 'My App',
      minIntervalSeconds: 60,
    });
    expect(result.success).toBe(true);
  });

  it('accepts config without password (update without changing password)', () => {
    const result = upsertSmtpConfigRequestSchema.safeParse({
      enabled: true,
      host: 'smtp.gmail.com',
      port: 587,
      username: 'user@gmail.com',
      senderEmail: 'noreply@myapp.com',
      senderName: 'My App',
    });
    expect(result.success).toBe(true);
  });

  it('uses default minIntervalSeconds of 60', () => {
    const result = upsertSmtpConfigRequestSchema.safeParse({
      enabled: false,
      host: 'smtp.test.com',
      port: 465,
      username: 'user',
      senderEmail: 'test@test.com',
      senderName: 'Test',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.minIntervalSeconds).toBe(60);
    }
  });

  it('rejects missing host', () => {
    const result = upsertSmtpConfigRequestSchema.safeParse({
      enabled: true,
      port: 465,
      username: 'user',
      senderEmail: 'test@test.com',
      senderName: 'Test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid port', () => {
    const result = upsertSmtpConfigRequestSchema.safeParse({
      enabled: true,
      host: 'smtp.test.com',
      port: 0,
      username: 'user',
      senderEmail: 'test@test.com',
      senderName: 'Test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects port above 65535', () => {
    const result = upsertSmtpConfigRequestSchema.safeParse({
      enabled: true,
      host: 'smtp.test.com',
      port: 70000,
      username: 'user',
      senderEmail: 'test@test.com',
      senderName: 'Test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid sender email', () => {
    const result = upsertSmtpConfigRequestSchema.safeParse({
      enabled: true,
      host: 'smtp.test.com',
      port: 465,
      username: 'user',
      senderEmail: 'not-an-email',
      senderName: 'Test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty username', () => {
    const result = upsertSmtpConfigRequestSchema.safeParse({
      enabled: true,
      host: 'smtp.test.com',
      port: 465,
      username: '',
      senderEmail: 'test@test.com',
      senderName: 'Test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty sender name', () => {
    const result = upsertSmtpConfigRequestSchema.safeParse({
      enabled: true,
      host: 'smtp.test.com',
      port: 465,
      username: 'user',
      senderEmail: 'test@test.com',
      senderName: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('Email Template Request Schema', () => {
  it('accepts valid template update', () => {
    const result = updateEmailTemplateRequestSchema.safeParse({
      subject: 'Verify your email',
      bodyHtml: '<p>Your code: {{ token }}</p>',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty subject', () => {
    const result = updateEmailTemplateRequestSchema.safeParse({
      subject: '',
      bodyHtml: '<p>Body</p>',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty body', () => {
    const result = updateEmailTemplateRequestSchema.safeParse({
      subject: 'Subject',
      bodyHtml: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing subject', () => {
    const result = updateEmailTemplateRequestSchema.safeParse({
      bodyHtml: '<p>Body</p>',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing body', () => {
    const result = updateEmailTemplateRequestSchema.safeParse({
      subject: 'Subject',
    });
    expect(result.success).toBe(false);
  });
});

describe('SMTP Config Response Schema', () => {
  it('validates a response with hasPassword boolean', () => {
    const result = smtpConfigSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      enabled: true,
      host: 'smtp.gmail.com',
      port: 465,
      username: 'user@gmail.com',
      hasPassword: true,
      senderEmail: 'noreply@myapp.com',
      senderName: 'My App',
      minIntervalSeconds: 60,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });
});

describe('Email Template Schema', () => {
  it('validates a template record', () => {
    const result = emailTemplateSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      templateType: 'email-verification-code',
      subject: 'Verify your email',
      bodyHtml: '<p>Code: {{ token }}</p>',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });
});
