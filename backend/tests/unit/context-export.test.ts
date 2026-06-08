import { describe, expect, it } from 'vitest';
import { MetadataService } from '../../src/services/metadata/metadata.service.js';
import type { AppMetadataSchema } from '@insforge/shared-schemas';

const metadataService = MetadataService.getInstance();

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
    buckets: [
      { name: 'avatars', public: true, createdAt: '2026-01-01T00:00:00Z', objectCount: 42 },
    ],
    totalSizeInGB: 0.5,
  },
  functions: [
    { slug: 'hello-world', name: 'hello-world', status: 'active', description: 'Test function' },
  ],
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

describe('MetadataService.formatAsMarkdown', () => {
  it('renders a complete markdown document from metadata', () => {
    const md = metadataService.formatAsMarkdown(sampleMetadata);

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

    const md = metadataService.formatAsMarkdown(minimal);

    expect(md).toContain('# Project Metadata');
    expect(md).toContain('No storage buckets configured.');
    expect(md).toContain('No edge functions deployed.');
    // Realtime section omitted entirely when undefined
    expect(md).not.toContain('## Realtime');
    // Deployments section omitted for self-hosted
    expect(md).not.toContain('## Deployments');
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

    const md = metadataService.formatAsMarkdown(withHint);

    expect(md).toContain('| users | 10 |');
    expect(md).toContain('Consider adding indexes');
  });

  it('renders deployments section for cloud projects', () => {
    const withDeployments: AppMetadataSchema = {
      ...sampleMetadata,
      deployments: { customSlug: 'my-app' },
    };

    const md = metadataService.formatAsMarkdown(withDeployments);

    expect(md).toContain('## Deployments');
    expect(md).toContain('`my-app`');
  });

  it('renders deployments with null slug', () => {
    const withNullSlug: AppMetadataSchema = {
      ...sampleMetadata,
      deployments: { customSlug: null },
    };

    const md = metadataService.formatAsMarkdown(withNullSlug);

    expect(md).toContain('## Deployments');
    expect(md).toContain('not set');
  });

  it('preserves backticks in values using double-backtick code spans', () => {
    const withBackticks: AppMetadataSchema = {
      ...sampleMetadata,
      database: {
        tables: [{ tableName: 'users', recordCount: 10 }],
        totalSizeInGB: 0.1,
        hint: 'Use `auth.uid()` for RLS policies',
      },
      functions: [
        {
          slug: 'check-`role`',
          name: 'check-role',
          status: 'active',
          description: 'Validates `admin` access',
        },
      ],
    };

    const md = metadataService.formatAsMarkdown(withBackticks);

    // Hint is plain text — backticks preserved as-is
    expect(md).toContain('Use `auth.uid()` for RLS policies');
    // Slug with backticks uses double-backtick code span
    expect(md).toContain('`` check-`role` ``');
    // Description is plain text — backticks preserved
    expect(md).toContain('Validates `admin` access');
  });

  it('escapes pipes in table cells without affecting code spans', () => {
    const withPipes: AppMetadataSchema = {
      ...sampleMetadata,
      database: {
        tables: [{ tableName: 'public|users', recordCount: 5 }],
        totalSizeInGB: 0.1,
      },
      storage: {
        buckets: [{ name: 'a|b', public: true, createdAt: '2026-01-01T00:00:00Z', objectCount: 1 }],
        totalSizeInGB: 0,
      },
    };

    const md = metadataService.formatAsMarkdown(withPipes);

    // Pipes escaped in table cells
    expect(md).toContain('| public\\|users | 5 |');
    // Bucket name in code span — pipes not escaped
    expect(md).toContain('`a|b`');
  });
});
