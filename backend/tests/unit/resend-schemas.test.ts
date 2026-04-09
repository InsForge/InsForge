import { describe, it, expect } from 'vitest';
import {
  resendConfigSchema,
  upsertResendConfigRequestSchema,
} from '@insforge/shared-schemas';

describe('Resend schemas', () => {
  describe('resendConfigSchema', () => {
    it('accepts a valid Resend config', () => {
      const result = resendConfigSchema.safeParse({
        id: '00000000-0000-0000-0000-000000000001',
        enabled: true,
        hasApiKey: true,
        senderEmail: 'noreply@example.com',
        senderName: 'My App',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      expect(result.success).toBe(true);
    });

    it('rejects config with invalid id', () => {
      const result = resendConfigSchema.safeParse({
        id: 'not-a-uuid',
        enabled: false,
        hasApiKey: false,
        senderEmail: '',
        senderName: '',
        createdAt: '',
        updatedAt: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('upsertResendConfigRequestSchema', () => {
    it('accepts a valid upsert request with API key', () => {
      const result = upsertResendConfigRequestSchema.safeParse({
        enabled: true,
        apiKey: 're_test_key_123',
        senderEmail: 'noreply@example.com',
        senderName: 'My App',
      });
      expect(result.success).toBe(true);
    });

    it('accepts request without API key (optional for updates)', () => {
      const result = upsertResendConfigRequestSchema.safeParse({
        enabled: true,
        senderEmail: 'noreply@example.com',
        senderName: 'My App',
      });
      expect(result.success).toBe(true);
    });

    it('rejects request with invalid sender email', () => {
      const result = upsertResendConfigRequestSchema.safeParse({
        enabled: true,
        apiKey: 're_test_key_123',
        senderEmail: 'not-an-email',
        senderName: 'My App',
      });
      expect(result.success).toBe(false);
    });

    it('rejects request with empty sender name', () => {
      const result = upsertResendConfigRequestSchema.safeParse({
        enabled: true,
        apiKey: 're_test_key_123',
        senderEmail: 'noreply@example.com',
        senderName: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects request with empty API key string', () => {
      const result = upsertResendConfigRequestSchema.safeParse({
        enabled: true,
        apiKey: '',
        senderEmail: 'noreply@example.com',
        senderName: 'My App',
      });
      expect(result.success).toBe(false);
    });

    it('rejects request without required fields', () => {
      const result = upsertResendConfigRequestSchema.safeParse({
        enabled: true,
      });
      expect(result.success).toBe(false);
    });
  });
});
