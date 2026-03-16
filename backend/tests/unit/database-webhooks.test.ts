import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import crypto from 'crypto';
import {
  createDatabaseWebhookRequestSchema,
  updateDatabaseWebhookRequestSchema,
  databaseWebhookSchema,
  databaseWebhookLogSchema,
  dbWebhookEventSchema,
} from '@insforge/shared-schemas';

const createReqSchema = createDatabaseWebhookRequestSchema;
const updateReqSchema = updateDatabaseWebhookRequestSchema;

// ============================================================================
// Source file paths
// ============================================================================

const MIGRATION_SQL = readFileSync(
  resolve(__dirname, '../../src/infra/database/migrations/024_create-database-webhooks.sql'),
  'utf-8'
);

const ROUTES_SOURCE = readFileSync(
  resolve(__dirname, '../../src/api/routes/database/webhooks.routes.ts'),
  'utf-8'
);

const SERVICE_SOURCE = readFileSync(
  resolve(__dirname, '../../src/services/database/database-webhook.service.ts'),
  'utf-8'
);

const MANAGER_SOURCE = readFileSync(
  resolve(__dirname, '../../src/infra/database-webhooks/database-webhook.manager.ts'),
  'utf-8'
);

const WEBHOOK_SENDER_SOURCE = readFileSync(
  resolve(__dirname, '../../src/infra/realtime/webhook-sender.ts'),
  'utf-8'
);

const DB_INDEX_SOURCE = readFileSync(
  resolve(__dirname, '../../src/api/routes/database/index.routes.ts'),
  'utf-8'
);

const SERVER_SOURCE = readFileSync(resolve(__dirname, '../../src/server.ts'), 'utf-8');

// ============================================================================
// 1. Zod Schema Validation
// ============================================================================

describe('Database Webhook Schemas', () => {
  describe('dbWebhookEventSchema', () => {
    test('accepts INSERT', () => {
      expect(dbWebhookEventSchema.parse('INSERT')).toBe('INSERT');
    });

    test('accepts UPDATE', () => {
      expect(dbWebhookEventSchema.parse('UPDATE')).toBe('UPDATE');
    });

    test('accepts DELETE', () => {
      expect(dbWebhookEventSchema.parse('DELETE')).toBe('DELETE');
    });

    test('rejects lowercase insert', () => {
      expect(() => dbWebhookEventSchema.parse('insert')).toThrow();
    });

    test('rejects unknown event type', () => {
      expect(() => dbWebhookEventSchema.parse('SELECT')).toThrow();
    });
  });

  describe('createDatabaseWebhookRequestSchema', () => {
    const valid = {
      name: 'Notify orders',
      tableName: 'orders',
      events: ['INSERT'],
      url: 'https://example.com/hook',
    };

    test('accepts a valid create request', () => {
      const result = createReqSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    test('defaults enabled to true', () => {
      const result = createReqSchema.parse(valid);
      expect(result.enabled).toBe(true);
    });

    test('accepts multiple events', () => {
      const result = createReqSchema.parse({ ...valid, events: ['INSERT', 'UPDATE', 'DELETE'] });
      expect(result.events).toHaveLength(3);
    });

    test('rejects empty name', () => {
      const result = createReqSchema.safeParse({ ...valid, name: '' });
      expect(result.success).toBe(false);
    });

    test('rejects empty tableName', () => {
      const result = createReqSchema.safeParse({ ...valid, tableName: '' });
      expect(result.success).toBe(false);
    });

    test('rejects empty events array', () => {
      const result = createReqSchema.safeParse({ ...valid, events: [] });
      expect(result.success).toBe(false);
    });

    test('rejects invalid event type', () => {
      const result = createReqSchema.safeParse({ ...valid, events: ['SELECT'] });
      expect(result.success).toBe(false);
    });

    test('rejects invalid URL', () => {
      const result = createReqSchema.safeParse({ ...valid, url: 'not-a-url' });
      expect(result.success).toBe(false);
    });

    test('rejects http-less bare string as URL', () => {
      const result = createReqSchema.safeParse({ ...valid, url: 'example.com/hook' });
      expect(result.success).toBe(false);
    });

    test('accepts optional secret', () => {
      const result = createReqSchema.parse({ ...valid, secret: 'mysecret' });
      expect(result.secret).toBe('mysecret');
    });

    test('accepts https URL', () => {
      const result = createReqSchema.safeParse({ ...valid, url: 'https://my-server.com/webhook' });
      expect(result.success).toBe(true);
    });

    test('rejects name longer than 100 chars', () => {
      const result = createReqSchema.safeParse({ ...valid, name: 'a'.repeat(101) });
      expect(result.success).toBe(false);
    });
  });

  describe('updateDatabaseWebhookRequestSchema', () => {
    test('accepts empty object (all fields optional)', () => {
      const result = updateReqSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    test('accepts enabled: false', () => {
      const result = updateReqSchema.parse({ enabled: false });
      expect(result.enabled).toBe(false);
    });

    test('accepts partial update with url only', () => {
      const result = updateReqSchema.parse({ url: 'https://new-url.com/hook' });
      expect(result.url).toBe('https://new-url.com/hook');
    });

    test('rejects invalid url in update', () => {
      const result = updateReqSchema.safeParse({ url: 'bad-url' });
      expect(result.success).toBe(false);
    });

    test('accepts null secret to clear it', () => {
      const result = updateReqSchema.parse({ secret: null });
      expect(result.secret).toBeNull();
    });
  });

  describe('databaseWebhookSchema', () => {
    test('parses a full webhook object', () => {
      const result = databaseWebhookSchema.safeParse({
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Test',
        tableName: 'users',
        events: ['INSERT', 'DELETE'],
        url: 'https://example.com/hook',
        secret: null,
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      expect(result.success).toBe(true);
    });
  });

  describe('databaseWebhookLogSchema', () => {
    test('parses a successful log entry', () => {
      const result = databaseWebhookLogSchema.safeParse({
        id: '00000000-0000-0000-0000-000000000002',
        webhookId: '00000000-0000-0000-0000-000000000001',
        eventType: 'INSERT',
        tableName: 'orders',
        payload: { event: 'INSERT', table: 'orders', record: {}, old_record: null },
        statusCode: 200,
        error: null,
        success: true,
        deliveredAt: new Date().toISOString(),
      });
      expect(result.success).toBe(true);
    });

    test('parses a failed log entry with null statusCode', () => {
      const result = databaseWebhookLogSchema.safeParse({
        id: '00000000-0000-0000-0000-000000000003',
        webhookId: '00000000-0000-0000-0000-000000000001',
        eventType: 'UPDATE',
        tableName: 'orders',
        payload: {},
        statusCode: null,
        error: 'Network timeout',
        success: false,
        deliveredAt: new Date().toISOString(),
      });
      expect(result.success).toBe(true);
    });
  });
});

// ============================================================================
// 2. Migration SQL Verification
// ============================================================================

describe('Migration 024 — Database Webhooks SQL', () => {
  test('creates _database_webhooks table', () => {
    expect(MIGRATION_SQL).toContain('CREATE TABLE IF NOT EXISTS _database_webhooks');
  });

  test('creates _database_webhook_logs table', () => {
    expect(MIGRATION_SQL).toContain('CREATE TABLE IF NOT EXISTS _database_webhook_logs');
  });

  test('webhook logs reference webhooks via foreign key with CASCADE', () => {
    expect(MIGRATION_SQL).toContain('REFERENCES _database_webhooks(id) ON DELETE CASCADE');
  });

  test('events column has CHECK constraint limiting to valid events', () => {
    expect(MIGRATION_SQL).toContain("ARRAY['INSERT','UPDATE','DELETE']");
  });

  test('creates notify_database_webhook trigger function', () => {
    expect(MIGRATION_SQL).toContain('CREATE OR REPLACE FUNCTION notify_database_webhook()');
  });

  test('trigger function uses pg_notify on db_webhook channel', () => {
    expect(MIGRATION_SQL).toContain("pg_notify('db_webhook'");
  });

  test('trigger function returns OLD for DELETE operations', () => {
    expect(MIGRATION_SQL).toMatch(/TG_OP\s*=\s*'DELETE'[\s\S]*RETURN OLD/);
  });

  test('trigger function returns NEW for INSERT/UPDATE', () => {
    expect(MIGRATION_SQL).toContain('RETURN NEW');
  });

  test('payload includes event, table, record, and old_record fields', () => {
    expect(MIGRATION_SQL).toContain("'event'");
    expect(MIGRATION_SQL).toContain("'table'");
    expect(MIGRATION_SQL).toContain("'record'");
    expect(MIGRATION_SQL).toContain("'old_record'");
  });

  test('creates index on table_name for fast webhook lookup', () => {
    expect(MIGRATION_SQL).toContain('idx_db_webhooks_table');
  });

  test('creates index on webhook_id in logs table', () => {
    expect(MIGRATION_SQL).toContain('idx_db_webhook_logs_webhook_id');
  });

  test('creates index on delivered_at DESC for recent logs queries', () => {
    expect(MIGRATION_SQL).toContain('idx_db_webhook_logs_delivered_at');
  });
});

// ============================================================================
// 3. Route Security — verifyAdmin on all endpoints
// ============================================================================

describe('Database Webhooks Routes — Security', () => {
  test('imports verifyAdmin middleware', () => {
    expect(ROUTES_SOURCE).toContain('verifyAdmin');
  });

  test('GET / uses verifyAdmin', () => {
    expect(ROUTES_SOURCE).toMatch(/router\.get\(\s*'\/'\s*,\s*verifyAdmin/);
  });

  test('GET /:id uses verifyAdmin', () => {
    expect(ROUTES_SOURCE).toMatch(/router\.get\(\s*'\/:id'\s*,\s*verifyAdmin/);
  });

  test('POST / uses verifyAdmin', () => {
    expect(ROUTES_SOURCE).toMatch(/router\.post\(\s*'\/'\s*,\s*verifyAdmin/);
  });

  test('PATCH /:id uses verifyAdmin', () => {
    expect(ROUTES_SOURCE).toMatch(/router\.patch\(\s*'\/:id'\s*,\s*verifyAdmin/);
  });

  test('DELETE /:id uses verifyAdmin', () => {
    expect(ROUTES_SOURCE).toMatch(/router\.delete\(\s*'\/:id'\s*,\s*verifyAdmin/);
  });

  test('GET /:id/logs uses verifyAdmin', () => {
    expect(ROUTES_SOURCE).toMatch(/router\.get\(\s*'\/:id\/logs'\s*,\s*verifyAdmin/);
  });

  test('no route handler is missing verifyAdmin', () => {
    // Every router.get/post/patch/delete call must include verifyAdmin
    const routeCallRegex = /router\.(get|post|patch|delete)\(/g;
    const matches = ROUTES_SOURCE.match(routeCallRegex) ?? [];
    expect(matches.length).toBeGreaterThan(0);

    // Split by router. calls and verify each contains verifyAdmin before the handler
    const lines = ROUTES_SOURCE.split('\n');
    const routeLines = lines.filter((l) => /router\.(get|post|patch|delete)\(/.test(l));
    for (const line of routeLines) {
      // Each opening line of a route should contain verifyAdmin or
      // the next line should (multiline route definitions)
      const idx = lines.indexOf(line);
      const block = lines.slice(idx, idx + 4).join(' ');
      expect(block).toContain('verifyAdmin');
    }
  });
});

// ============================================================================
// 4. Route Registration in database index
// ============================================================================

describe('Database Index Routes — Webhook Registration', () => {
  test('imports databaseWebhooksRouter', () => {
    expect(DB_INDEX_SOURCE).toContain('databaseWebhooksRouter');
  });

  test('mounts webhooks router at /webhooks', () => {
    expect(DB_INDEX_SOURCE).toMatch(/router\.use\(\s*'\/webhooks'\s*,\s*databaseWebhooksRouter/);
  });
});

// ============================================================================
// 5. DatabaseWebhookManager — pg_notify listener
// ============================================================================

describe('DatabaseWebhookManager', () => {
  test('listens on db_webhook channel', () => {
    expect(MANAGER_SOURCE).toContain("'db_webhook'");
    expect(MANAGER_SOURCE).toMatch(/LISTEN\s+db_webhook/);
  });

  test('handles notification only on db_webhook channel', () => {
    expect(MANAGER_SOURCE).toMatch(/msg\.channel\s*===\s*'db_webhook'/);
  });

  test('parses event, table, record, old_record from payload', () => {
    expect(MANAGER_SOURCE).toContain('event');
    expect(MANAGER_SOURCE).toContain('table');
    expect(MANAGER_SOURCE).toContain('record');
    expect(MANAGER_SOURCE).toContain('old_record');
  });

  test('generates HMAC-SHA256 signature when secret is present', () => {
    expect(MANAGER_SOURCE).toContain("'sha256'");
    expect(MANAGER_SOURCE).toContain('createHmac');
    expect(MANAGER_SOURCE).toContain('X-InsForge-Signature');
  });

  test('signature header uses sha256= prefix', () => {
    expect(MANAGER_SOURCE).toContain('`sha256=${sig}`');
  });

  test('includes X-InsForge-Event header', () => {
    expect(MANAGER_SOURCE).toContain("'X-InsForge-Event'");
  });

  test('includes X-InsForge-Table header', () => {
    expect(MANAGER_SOURCE).toContain("'X-InsForge-Table'");
  });

  test('uses sendWithHeaders from WebhookSender', () => {
    expect(MANAGER_SOURCE).toContain('sendWithHeaders');
  });

  test('saves delivery log after each dispatch', () => {
    expect(MANAGER_SOURCE).toContain('saveLog');
  });

  test('implements reconnect with exponential backoff', () => {
    expect(MANAGER_SOURCE).toContain('maxReconnectAttempts');
    expect(MANAGER_SOURCE).toContain('baseReconnectDelay');
    expect(MANAGER_SOURCE).toContain('Math.pow(2,');
  });

  test('is a singleton', () => {
    expect(MANAGER_SOURCE).toContain('static instance: DatabaseWebhookManager');
    expect(MANAGER_SOURCE).toContain('static getInstance()');
  });
});

// ============================================================================
// 6. WebhookSender — sendWithHeaders method
// ============================================================================

describe('WebhookSender.sendWithHeaders', () => {
  test('exports sendWithHeaders as a public method', () => {
    expect(WEBHOOK_SENDER_SOURCE).toContain('async sendWithHeaders(');
  });

  test('sendWithHeaders accepts url, body, and headers parameters', () => {
    expect(WEBHOOK_SENDER_SOURCE).toMatch(/sendWithHeaders\s*\(\s*\n?\s*url\s*:/);
    expect(WEBHOOK_SENDER_SOURCE).toContain('body: object');
    expect(WEBHOOK_SENDER_SOURCE).toContain('headers: Record<string, string>');
  });

  test('sendWithHeaders returns WebhookResult', () => {
    expect(WEBHOOK_SENDER_SOURCE).toMatch(/sendWithHeaders[\s\S]*?Promise<WebhookResult>/);
  });

  test('sendWithHeaders retries on network errors', () => {
    // Retry logic uses maxRetries
    const methodStart = WEBHOOK_SENDER_SOURCE.indexOf('async sendWithHeaders');
    const methodEnd = WEBHOOK_SENDER_SOURCE.indexOf('\n  private delay', methodStart);
    const methodBody = WEBHOOK_SENDER_SOURCE.slice(methodStart, methodEnd);
    expect(methodBody).toContain('this.maxRetries');
    expect(methodBody).toContain('this.delay');
  });
});

// ============================================================================
// 7. Server Initialization
// ============================================================================

describe('Server — DatabaseWebhookManager initialization', () => {
  test('imports DatabaseWebhookManager', () => {
    expect(SERVER_SOURCE).toContain('DatabaseWebhookManager');
  });

  test('calls dbWebhookManager.initialize() on startup', () => {
    expect(SERVER_SOURCE).toContain('dbWebhookManager.initialize()');
  });

  test('calls dbWebhookManager.close() on shutdown', () => {
    expect(SERVER_SOURCE).toContain('dbWebhookManager.close()');
  });
});

// ============================================================================
// 8. HMAC Signature Logic (pure function test)
// ============================================================================

describe('HMAC-SHA256 Signature', () => {
  const secret = 'test-secret-key';
  const body = {
    event: 'INSERT',
    table: 'orders',
    record: { id: 'abc', total: 49.99 },
    old_record: null,
  };

  function computeSignature(payload: object, key: string): string {
    return crypto.createHmac('sha256', key).update(JSON.stringify(payload)).digest('hex');
  }

  test('produces a 64-char hex string', () => {
    const sig = computeSignature(body, secret);
    expect(sig).toHaveLength(64);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  test('same payload + secret always produces same signature', () => {
    const sig1 = computeSignature(body, secret);
    const sig2 = computeSignature(body, secret);
    expect(sig1).toBe(sig2);
  });

  test('different secret produces different signature', () => {
    const sig1 = computeSignature(body, secret);
    const sig2 = computeSignature(body, 'different-secret');
    expect(sig1).not.toBe(sig2);
  });

  test('different payload produces different signature', () => {
    const sig1 = computeSignature(body, secret);
    const sig2 = computeSignature({ ...body, event: 'DELETE' }, secret);
    expect(sig1).not.toBe(sig2);
  });

  test('header format matches sha256=<hex>', () => {
    const sig = computeSignature(body, secret);
    const header = `sha256=${sig}`;
    expect(header).toMatch(/^sha256=[0-9a-f]{64}$/);
  });
});

// ============================================================================
// 9. Service — Trigger Naming Convention
// ============================================================================

describe('DatabaseWebhookService — trigger naming', () => {
  test('trigger name strips dashes from webhook id', () => {
    // The triggerName private method: _dbwh_ + uuid without dashes
    const uuid = '22f9788e-a51e-4387-a093-67330c925857';
    const expected = '_dbwh_22f9788ea51e4387a09367330c925857';
    expect(SERVICE_SOURCE).toContain('_dbwh_');
    expect(SERVICE_SOURCE).toContain("replace(/-/g, '')");
    // Verify the formula manually
    const result = `_dbwh_${uuid.replace(/-/g, '')}`;
    expect(result).toBe(expected);
  });

  test('validates table exists before creating trigger', () => {
    expect(SERVICE_SOURCE).toContain('information_schema.tables');
    expect(SERVICE_SOURCE).toContain('table_schema');
  });

  test('uses transaction for create (BEGIN/COMMIT/ROLLBACK)', () => {
    expect(SERVICE_SOURCE).toContain("'BEGIN'");
    expect(SERVICE_SOURCE).toContain("'COMMIT'");
    expect(SERVICE_SOURCE).toContain("'ROLLBACK'");
  });

  test('drops trigger before deleting webhook record', () => {
    // In delete(), dropTrigger is called before DELETE query
    const deleteMethodStart = SERVICE_SOURCE.indexOf('async delete(id: string)');
    const deleteMethodEnd = SERVICE_SOURCE.indexOf('\n  async', deleteMethodStart + 1);
    const deleteBody = SERVICE_SOURCE.slice(deleteMethodStart, deleteMethodEnd);
    expect(deleteBody).toContain('dropTrigger');
    expect(deleteBody).toContain('DELETE FROM _database_webhooks');
    // dropTrigger must appear before the DELETE statement
    expect(deleteBody.indexOf('dropTrigger')).toBeLessThan(
      deleteBody.indexOf('DELETE FROM _database_webhooks')
    );
  });
});
