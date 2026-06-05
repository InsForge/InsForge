import { describe, expect, it } from 'vitest';
import { formatContextAsMarkdown } from '../../src/utils/context-formatter.js';
import type { AppMetadataSchema } from '@insforge/shared-schemas';

const sampleMetadata: AppMetadataSchema = {
  version: '1.2.3',
  auth: {
    oAuthProviders: ['google', 'github'],
    customOAuthProviders: [],
    smtpConfig: {
      enabled: false,
      host: '',
      port: 587,
      username: '',
      hasPassword: false,
      senderEmail: '',
      senderName: '',
      minIntervalSeconds: 60,
    },
    requireEmailVerification: true,
    disableSignup: false,
    passwordMinLength: 8,
    requireNumber: false,
    requireLowercase: false,
    requireUppercase: false,
    requireSpecialChar: false,
    verifyEmailMethod: 'otp',
    resetPasswordMethod: 'otp',
    allowedRedirectUrls: [],
  },
  database: {
    tables: [
      { tableName: 'users', recordCount: 150 },
      { tableName: 'posts', recordCount: 1200 },
    ],
    totalSizeInGB: 0.3,
  },
  storage: {
    buckets: [{ name: 'avatars', public: true, createdAt: '2026-01-01T00:00:00Z', objectCount: 42 }],
    totalSizeInGB: 0.5,
  },
  functions: [{ slug: 'hello-world', name: 'hello-world', status: 'active', description: 'Test function' }],
  realtime: {
    channels: [
      {
        id: '00000000-0000-0000-0000-000000000001',
        pattern: 'chat',
        description: null,
        webhookUrls: null,
        enabled: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
    permissions: { tables: {} },
  },
};

describe('formatContextAsMarkdown', () => {
  it('renders a complete markdown document from metadata', () => {
    const md = formatContextAsMarkdown(sampleMetadata);

    // Header
    expect(md).toContain('# Project Metadata');
    expect(md).toContain('v1.2.3');

    // Auth
    expect(md).toContain('## Auth');
    expect(md).toContain('google, github');
    expect(md).toContain('required');
    expect(md).toContain('enabled');

    // Database tables
    expect(md).toContain('| users | 150 |');
    expect(md).toContain('| posts | 1200 |');
    expect(md).toContain('0.3 GB');

    // Storage
    expect(md).toContain('`avatars`');
    expect(md).toContain('public');
    expect(md).toContain('42 objects');
    expect(md).toContain('0.5 GB');

    // Functions
    expect(md).toContain('`hello-world`');
    expect(md).toContain('active');
    expect(md).toContain('Test function');

    // Realtime
    expect(md).toContain('`chat`');
  });

  it('handles missing optional sections gracefully', () => {
    const minimal: AppMetadataSchema = {
      auth: {
        oAuthProviders: [],
        customOAuthProviders: [],
        smtpConfig: {
          enabled: false,
          host: '',
          port: 587,
          username: '',
          hasPassword: false,
          senderEmail: '',
          senderName: '',
          minIntervalSeconds: 60,
        },
        requireEmailVerification: false,
        disableSignup: false,
        passwordMinLength: 8,
        requireNumber: false,
        requireLowercase: false,
        requireUppercase: false,
        requireSpecialChar: false,
        verifyEmailMethod: 'otp',
        resetPasswordMethod: 'otp',
        allowedRedirectUrls: [],
      },
      database: {
        tables: [],
        totalSizeInGB: 0,
      },
      storage: {
        buckets: [],
        totalSizeInGB: 0,
      },
      functions: [],
    };

    const md = formatContextAsMarkdown(minimal);

    expect(md).toContain('# Project Metadata');
    expect(md).toContain('No storage buckets configured.');
    expect(md).toContain('No edge functions deployed.');
    // Realtime section omitted entirely when undefined
    expect(md).not.toContain('## Realtime');
  });

  it('renders database hint when present', () => {
    const withHint: AppMetadataSchema = {
      ...sampleMetadata,
      database: {
        tables: [{ tableName: 'users', recordCount: 10 }],
        totalSizeInGB: 0.1,
        hint: 'Consider adding indexes',
      },
    };

    const md = formatContextAsMarkdown(withHint);

    expect(md).toContain('| users | 10 |');
    expect(md).toContain('Consider adding indexes');
  });
});
