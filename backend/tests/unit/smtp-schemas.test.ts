import { describe, it, expect } from 'vitest';
import {
  upsertSmtpConfigRequestSchema,
  updateEmailTemplateRequestSchema,
  smtpConfigSchema,
  emailTemplateSchema,
  authConfigAdminResponseSchema,
  getPublicAuthConfigResponseSchema,
  adminSmtpMetadataSchema,
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

  it('accepts disabled config with empty connection fields', () => {
    // Regression: disabling custom SMTP should not require filling in host/username/etc.
    const result = upsertSmtpConfigRequestSchema.safeParse({
      enabled: false,
      host: '',
      port: 587,
      username: '',
      senderEmail: '',
      senderName: '',
    });
    expect(result.success).toBe(true);
  });

  it('accepts disabled config with only enabled and port', () => {
    const result = upsertSmtpConfigRequestSchema.safeParse({
      enabled: false,
      port: 587,
    });
    expect(result.success).toBe(true);
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

describe('SMTP in admin/public metadata response', () => {
  // The admin metadata response is what /api/metadata returns (admin-gated).
  // It MUST include smtpConfig so the CLI can probe backend capability before
  // applying TOML changes. The public response (unauthenticated) MUST NOT
  // include it — SMTP host can leak internal infrastructure.

  const adminSmtpSlice = {
    enabled: true,
    host: 'smtp.gmail.com',
    port: 465,
    username: 'user@gmail.com',
    hasPassword: true,
    senderEmail: 'noreply@myapp.com',
    senderName: 'My App',
    minIntervalSeconds: 60,
  };

  const baseAdminResponse = {
    oAuthProviders: [],
    customOAuthProviders: [],
    smtpConfig: adminSmtpSlice,
    requireEmailVerification: false,
    passwordMinLength: 8,
    requireNumber: false,
    requireLowercase: false,
    requireUppercase: false,
    requireSpecialChar: false,
    verifyEmailMethod: 'code' as const,
    resetPasswordMethod: 'code' as const,
    allowedRedirectUrls: [],
    disableSignup: false,
  };

  it('admin response includes smtpConfig with hasPassword', () => {
    const result = authConfigAdminResponseSchema.safeParse(baseAdminResponse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.smtpConfig.hasPassword).toBe(true);
      expect(result.data.smtpConfig.host).toBe('smtp.gmail.com');
    }
  });

  it('admin smtp slice has no id / createdAt / updatedAt (rendering metadata)', () => {
    const withRowMetadata = {
      ...adminSmtpSlice,
      id: '00000000-0000-0000-0000-000000000001',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    // Strict parse: extra keys should be stripped, not error. We verify the
    // parsed output doesn't carry them through (zod strips unknown keys by default).
    const result = adminSmtpMetadataSchema.safeParse(withRowMetadata);
    expect(result.success).toBe(true);
    if (result.success) {
      expect('id' in result.data).toBe(false);
      expect('createdAt' in result.data).toBe(false);
      expect('updatedAt' in result.data).toBe(false);
    }
  });

  it('admin smtp slice does NOT include a password field', () => {
    // The shape only carries hasPassword; the actual credential never crosses
    // the wire. If someone tries to add a `password` field, it must be stripped
    // and definitely not present in the type.
    const withPassword = {
      ...adminSmtpSlice,
      password: 'literal-secret-that-should-never-leak',
    };
    const result = adminSmtpMetadataSchema.safeParse(withPassword);
    expect(result.success).toBe(true);
    if (result.success) {
      expect('password' in result.data).toBe(false);
    }
  });

  it('public response omits smtpConfig (admin-only — host can leak internal infra)', () => {
    const publicShape: Record<string, unknown> = { ...baseAdminResponse };
    delete publicShape.smtpConfig;
    delete publicShape.allowedRedirectUrls;
    const result = getPublicAuthConfigResponseSchema.safeParse(publicShape);
    expect(result.success).toBe(true);
    if (result.success) {
      expect('smtpConfig' in result.data).toBe(false);
      expect('allowedRedirectUrls' in result.data).toBe(false);
    }
  });

  it('public response still parses when smtpConfig is mistakenly included (strips it)', () => {
    // Belt-and-suspenders: even if a future code change accidentally sends
    // smtpConfig through the public route, zod's default strip behavior drops
    // it from the parsed output.
    const result = getPublicAuthConfigResponseSchema.safeParse(baseAdminResponse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect('smtpConfig' in result.data).toBe(false);
    }
  });
});
