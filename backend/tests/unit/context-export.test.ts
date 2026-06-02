import { describe, expect, it } from 'vitest';
import { formatContextAsMarkdown } from '../../src/utils/context-formatter.js';

const sampleContext = {
  exportedAt: '2026-06-01T12:00:00.000Z',
  version: '1.2.3',
  auth: {
    oAuthProviders: ['google', 'github'],
    customOAuthProviders: [],
    requireEmailVerification: true,
    disableSignup: false,
  },
  database: {
    schemas: [
      { name: 'public', isProtected: false },
      { name: 'auth', isProtected: true },
    ],
    tables: {
      users: {
        schema: [
          {
            columnName: 'id',
            dataType: 'uuid',
            isNullable: 'NO',
            columnDefault: 'gen_random_uuid()',
          },
          { columnName: 'email', dataType: 'text', isNullable: 'NO', columnDefault: null },
        ],
        indexes: [],
        foreignKeys: [
          {
            columnName: 'org_id',
            foreignTableName: 'orgs',
            foreignColumnName: 'id',
          },
        ],
        rlsEnabled: true,
        policies: [{ policyname: 'users_select', cmd: 'SELECT', roles: '{authenticated}' }],
        triggers: [],
        rows: [],
      },
    },
    indexes: [{ indexName: 'users_pkey', tableName: 'users', isPrimary: true, isUnique: true }],
    policies: [
      {
        policyName: 'users_select',
        tableName: 'users',
        cmd: 'SELECT',
        roles: '{authenticated}',
      },
    ],
    triggers: [
      {
        triggerName: 'audit_trigger',
        tableName: 'users',
        actionTiming: 'AFTER',
        eventManipulation: 'INSERT',
      },
    ],
  },
  storage: {
    buckets: [{ name: 'avatars', public: true, objectCount: 42 }],
    totalSizeInGB: 0.5,
  },
  functions: [{ slug: 'hello-world', status: 'active', description: 'Test function' }],
  realtime: {
    channels: [{ name: 'chat' }],
  },
};

describe('formatContextAsMarkdown', () => {
  it('renders a complete markdown document from context', () => {
    const md = formatContextAsMarkdown(sampleContext);

    // Header
    expect(md).toContain('# Project Context Export');
    expect(md).toContain('2026-06-01T12:00:00.000Z');
    expect(md).toContain('v1.2.3');

    // Auth
    expect(md).toContain('## Auth');
    expect(md).toContain('google, github');
    expect(md).toContain('required');
    expect(md).toContain('enabled');

    // Database schemas
    expect(md).toContain('`public`');
    expect(md).toContain('`auth` (protected)');

    // Table columns
    expect(md).toContain('| id | uuid | no | gen_random_uuid() |');
    expect(md).toContain('| email | text | no | - |');

    // Foreign keys
    expect(md).toContain('`org_id` → `orgs.id`');

    // RLS + policies
    expect(md).toContain('**RLS**: enabled');
    expect(md).toContain('`users_select`');

    // Indexes
    expect(md).toContain('`users_pkey`');
    expect(md).toContain('(PK, UNIQUE)');

    // Triggers
    expect(md).toContain('`audit_trigger`');
    expect(md).toContain('AFTER INSERT');

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

  it('handles empty/missing sections gracefully', () => {
    const minimal = {
      exportedAt: '2026-01-01T00:00:00Z',
      version: '0.0.1',
      auth: null,
      database: null,
      storage: null,
      functions: [],
      realtime: null,
    };

    const md = formatContextAsMarkdown(minimal);

    expect(md).toContain('# Project Context Export');
    expect(md).toContain('No edge functions deployed.');
    // Should not throw
  });

  it('handles tables with no foreign keys or policies', () => {
    const context = {
      exportedAt: '2026-01-01T00:00:00Z',
      version: '1.0.0',
      auth: { oAuthProviders: [] },
      database: {
        tables: {
          logs: {
            schema: [
              { columnName: 'id', dataType: 'integer', isNullable: 'NO', columnDefault: null },
            ],
            indexes: [],
            foreignKeys: [],
            rlsEnabled: false,
            policies: [],
            triggers: [],
            rows: [],
          },
        },
      },
      storage: { buckets: [] },
      functions: null,
      realtime: { channels: [] },
    };

    const md = formatContextAsMarkdown(context);

    expect(md).toContain('#### logs');
    expect(md).toContain('| id | integer | no | - |');
    expect(md).not.toContain('**RLS**: enabled');
    expect(md).not.toContain('**Foreign keys:**');
    expect(md).toContain('No storage buckets configured.');
    expect(md).toContain('No edge functions deployed.');
    expect(md).toContain('No realtime channels configured.');
  });
});
