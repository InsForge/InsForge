import { describe, it, expect, vi } from 'vitest';
import { CloudWatchProvider } from '../../src/providers/logs/cloudwatch.provider';

vi.mock('../../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// normalizeBody/parseRawLine are private; access via bracket notation.
// They do not touch the AWS SDK client, so an uninitialized provider is safe.
type NormalizeFn = (rawMessage: string, sourceName: string) => Record<string, unknown>;
type ParseFn = (message: string, sourceName: string) => Record<string, unknown>;

const provider = new CloudWatchProvider();
const normalizeBody: NormalizeFn = (
  provider as unknown as { normalizeBody: NormalizeFn }
).normalizeBody.bind(provider);
const parseRawLine: ParseFn = (provider as unknown as { parseRawLine: ParseFn }).parseRawLine.bind(
  provider
);

describe('CloudWatchProvider.normalizeBody', () => {
  it('passes already-Vector-shaped payloads through unchanged', () => {
    const input = {
      event_message: 'something happened',
      appname: 'insforge',
      metadata: { level: 'error', extra: 'value' },
    };
    const out = normalizeBody(JSON.stringify(input), 'insforge.logs');
    expect(out).toEqual(input);
  });

  it('normalizes appname-only Vector payloads so they still expose event_message', () => {
    // Passthrough now requires event_message as well as metadata.level — an
    // appname-only payload would otherwise leak through with no message column.
    const input = {
      appname: 'insforge',
      metadata: { level: 'info' },
      foo: 'bar',
    };
    const out = normalizeBody(JSON.stringify(input), 'insforge.logs');
    expect(out).toMatchObject({ appname: 'insforge', foo: 'bar' });
    expect(typeof out.event_message).toBe('string');
    expect((out.metadata as { level: string }).level).toBe('info');
  });

  it('does not pass through when appname exists but metadata.level is missing', () => {
    // Without metadata.level the dashboard would render as informational, so we
    // must run the Winston path to lift any top-level `level` field.
    const input = {
      appname: 'insforge',
      level: 'error',
      message: 'boom',
    };
    const out = normalizeBody(JSON.stringify(input), 'insforge.logs');
    expect((out.metadata as { level: string }).level).toBe('error');
    expect(out.event_message).toBe('error - boom');
  });

  it('lifts Winston level + message into Vector shape with "level - message" prefix', () => {
    const input = {
      level: 'info',
      message: 'started',
      timestamp: '2024-01-01T00:00:00Z',
      metadata: { requestId: 'abc' },
    };
    const out = normalizeBody(JSON.stringify(input), 'insforge.logs');
    expect(out.event_message).toBe('info - started');
    expect(out.metadata).toEqual({ requestId: 'abc', level: 'info' });
    expect(out.timestamp).toBe('2024-01-01T00:00:00Z');
    expect(out).not.toHaveProperty('level');
    expect(out).not.toHaveProperty('message');
  });

  it('keeps Winston error/stack as top-level body keys without inlining into event_message', () => {
    const input = {
      level: 'error',
      message: 'request failed',
      error: 'TypeError: x is undefined',
      stack: 'at foo (file.ts:1)\nat bar (file.ts:2)',
    };
    const out = normalizeBody(JSON.stringify(input), 'insforge.logs');
    expect(out.event_message).toBe('error - request failed');
    expect((out.metadata as { level: string }).level).toBe('error');
    expect(out.error).toBe('TypeError: x is undefined');
    expect(out.stack).toBe('at foo (file.ts:1)\nat bar (file.ts:2)');
  });

  it('lowercases the Winston level field', () => {
    const input = { level: 'ERROR', message: 'oops' };
    const out = normalizeBody(JSON.stringify(input), 'insforge.logs');
    expect((out.metadata as { level: string }).level).toBe('error');
    expect(out.event_message).toBe('error - oops');
  });

  it('strips the msg key (pino-style) and prefixes level on the rest spread', () => {
    const input = { level: 'info', msg: 'hello', extra: 1 };
    const out = normalizeBody(JSON.stringify(input), 'insforge.logs');
    expect(out.event_message).toBe('info - hello');
    expect(out).not.toHaveProperty('msg');
    expect(out.extra).toBe(1);
  });

  it('flattens Winston request logs into snake_case fields and an nginx-style event_message', () => {
    const input = {
      level: 'info',
      message: 'HTTP request',
      method: 'GET',
      path: '/rest/v1/users',
      status: 200,
      size: 1234,
      duration: '12.3ms',
      ip: '127.0.0.1',
      userAgent: 'curl/8.0',
      timestamp: '2024-01-01T00:00:00Z',
    };
    const out = normalizeBody(JSON.stringify(input), 'insforge.logs');
    expect(out.event_message).toBe('GET /rest/v1/users 200 1234 12.3ms - 127.0.0.1 - curl/8.0');
    expect(out.method).toBe('GET');
    expect(out.path).toBe('/rest/v1/users');
    expect(out.status_code).toBe(200);
    expect(out.size).toBe(1234);
    expect(out.duration).toBe('12.3ms');
    expect(out.ip).toBe('127.0.0.1');
    expect(out.user_agent).toBe('curl/8.0');
    expect((out.metadata as { level: string }).level).toBe('info');
    // camelCase source keys are dropped in favor of the snake_case re-emits
    expect(out).not.toHaveProperty('userAgent');
    expect(out).not.toHaveProperty('status');
    // Non-request keys still pass through
    expect(out.timestamp).toBe('2024-01-01T00:00:00Z');
  });

  it('treats logs without duration as application logs even when they have method/path', () => {
    // Edge case: a non-request log that happens to mention a method/path. The
    // request branch is keyed strictly on `duration` to match Vector's check.
    const input = { level: 'info', message: 'routing', method: 'GET', path: '/foo' };
    const out = normalizeBody(JSON.stringify(input), 'insforge.logs');
    expect(out.event_message).toBe('info - routing');
    expect(out).not.toHaveProperty('status_code');
  });

  it('falls back to raw text parsing on malformed JSON', () => {
    const out = normalizeBody('not json {{{', 'insforge.logs');
    expect(out).toHaveProperty('event_message', 'not json {{{');
    expect(out.metadata).toEqual({ level: 'info' });
  });

  it('falls back to raw text parsing on JSON arrays', () => {
    const out = normalizeBody('[1,2,3]', 'insforge.logs');
    expect(out).toHaveProperty('event_message', '[1,2,3]');
    expect(out.metadata).toBeDefined();
  });

  it('defaults metadata.level to info when JSON has no level field', () => {
    const input = { message: 'no level here', foo: 'bar' };
    const out = normalizeBody(JSON.stringify(input), 'insforge.logs');
    expect(out.event_message).toBe('no level here');
    expect((out.metadata as { level: string }).level).toBe('info');
    expect(out.foo).toBe('bar');
  });

  it('handles empty input', () => {
    const out = normalizeBody('', 'insforge.logs');
    expect(out).toHaveProperty('event_message', '');
    expect(out.metadata).toBeDefined();
  });
});

describe('CloudWatchProvider.parseRawLine - postgres.logs', () => {
  it('parses ERROR lines and maps to lowercase error', () => {
    const out = parseRawLine(
      '2024-01-01 12:34:56.789 UTC [123] ERROR: relation "x" does not exist',
      'postgres.logs'
    );
    expect((out.metadata as { level: string }).level).toBe('error');
    expect(out.event_message).toBe('relation "x" does not exist');
  });

  it('promotes FATAL to error', () => {
    const out = parseRawLine(
      '2024-01-01 12:34:56.789 UTC [123] FATAL: the database system is shutting down',
      'postgres.logs'
    );
    expect((out.metadata as { level: string }).level).toBe('error');
  });

  it('promotes PANIC to error', () => {
    const out = parseRawLine(
      '2024-01-01 12:34:56.789 UTC [123] PANIC: corrupt page in block 42',
      'postgres.logs'
    );
    expect((out.metadata as { level: string }).level).toBe('error');
  });

  it('demotes STATEMENT and DETAIL to info', () => {
    const stmt = parseRawLine(
      '2024-01-01 12:34:56.789 UTC [123] STATEMENT: SELECT 1',
      'postgres.logs'
    );
    expect((stmt.metadata as { level: string }).level).toBe('info');
    const detail = parseRawLine(
      '2024-01-01 12:34:56.789 UTC [123] DETAIL: extra info',
      'postgres.logs'
    );
    expect((detail.metadata as { level: string }).level).toBe('info');
  });

  it('maps WARNING to warn so the dashboard shows the warning badge', () => {
    const out = parseRawLine(
      '2024-01-01 12:34:56.789 UTC [123] WARNING: deprecated function',
      'postgres.logs'
    );
    expect((out.metadata as { level: string }).level).toBe('warn');
  });

  it('maps LOG/INFO/NOTICE to lowercase variants', () => {
    const log = parseRawLine(
      '2024-01-01 12:34:56.789 UTC [1] LOG: database system is ready',
      'postgres.logs'
    );
    expect((log.metadata as { level: string }).level).toBe('log');
  });

  it('falls back to log level for unrecognized postgres lines', () => {
    const out = parseRawLine('garbled postgres output', 'postgres.logs');
    expect((out.metadata as { level: string }).level).toBe('log');
    expect(out.event_message).toBe('garbled postgres output');
  });
});

describe('CloudWatchProvider.parseRawLine - postgREST.logs', () => {
  it('parses postgREST access lines with info level', () => {
    const out = parseRawLine(
      '15/Jan/2024:12:34:56 +0000: 127.0.0.1 - GET /rest/v1/users 200',
      'postgREST.logs'
    );
    expect((out.metadata as { level: string }).level).toBe('info');
    expect(out.event_message).toBe('127.0.0.1 - GET /rest/v1/users 200');
  });

  it('infers error from schema-cache failure lines', () => {
    // PostgREST surfaces startup/schema-cache problems without the access-log
    // prefix; "Database connection error" should drive the error badge.
    const out = parseRawLine(
      'Failed to load the schema cache. {"code":"PGRST000","message":"Database connection error. Retrying the connection."}',
      'postgREST.logs'
    );
    expect((out.metadata as { level: string }).level).toBe('error');
  });

  it('strips timestamp prefix and still infers error for schema-cache failures', () => {
    // Real PostgREST output prefixes *every* line — access AND error — with
    // the same timestamp. Strip the prefix, but keep keyword inference active.
    const out = parseRawLine(
      '15/Jan/2024:12:34:56 +0000: Failed to load the schema cache. {"code":"PGRST000","message":"Database connection error. Retrying."}',
      'postgREST.logs'
    );
    expect((out.metadata as { level: string }).level).toBe('error');
    expect(out.event_message).toBe(
      'Failed to load the schema cache. {"code":"PGRST000","message":"Database connection error. Retrying."}'
    );
  });

  it('infers error from upstream FATAL lines forwarded by postgREST', () => {
    const out = parseRawLine(
      'FATAL:  terminating connection due to administrator command',
      'postgREST.logs'
    );
    expect((out.metadata as { level: string }).level).toBe('error');
  });

  it('infers warn from postgREST warning lines', () => {
    const out = parseRawLine('Warning: deprecated configuration option', 'postgREST.logs');
    expect((out.metadata as { level: string }).level).toBe('warn');
  });

  it('falls back to info for unrecognized postgREST lines', () => {
    const out = parseRawLine('unparseable postgREST output', 'postgREST.logs');
    expect((out.metadata as { level: string }).level).toBe('info');
  });
});

describe('CloudWatchProvider.parseRawLine - function.logs', () => {
  it('parses function logs with lowercase level', () => {
    const out = parseRawLine('12:34:56.789 [ERROR] handler crashed', 'function.logs');
    expect((out.metadata as { level: string }).level).toBe('error');
    expect(out.event_message).toBe('handler crashed');
  });

  it('falls back to keyword inference when no timestamp prefix matches', () => {
    const out = parseRawLine('handler crashed with exception', 'function.logs');
    expect((out.metadata as { level: string }).level).toBe('error');
  });
});

describe('CloudWatchProvider.parseRawLine - keyword fallback', () => {
  it('infers error level from common keywords', () => {
    expect(
      (parseRawLine('something raised an exception', 'unknown').metadata as { level: string }).level
    ).toBe('error');
    expect(
      (parseRawLine('fatal: cannot continue', 'unknown').metadata as { level: string }).level
    ).toBe('error');
  });

  it('infers warn level from warning keywords', () => {
    expect(
      (parseRawLine('warning: deprecated', 'unknown').metadata as { level: string }).level
    ).toBe('warn');
  });

  it('defaults to info for benign text', () => {
    expect((parseRawLine('routine message', 'unknown').metadata as { level: string }).level).toBe(
      'info'
    );
  });

  it('strips the [backend] prefix before inferring level', () => {
    const out = parseRawLine('[backend] all good here', 'unknown');
    expect(out.event_message).toBe('all good here');
    expect((out.metadata as { level: string }).level).toBe('info');
  });
});
