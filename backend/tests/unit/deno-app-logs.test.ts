import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DenoSubhostingProvider } from '../../src/providers/functions/deno-subhosting.provider';
import { LogService } from '../../src/services/logs/log.service';
import { FunctionService } from '../../src/services/functions/function.service';
import { AppError } from '../../src/utils/errors';
import { ERROR_CODES } from '@insforge/shared-schemas';

// Mock node-fetch — use vi.hoisted so the variable is available in the hoisted vi.mock factory
const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.mock('node-fetch', () => ({
  default: mockFetch,
  Request: vi.fn(),
  Response: vi.fn(),
  Headers: vi.fn(),
}));

// Mock logger
vi.mock('../../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock config. `cloud.appKey` is the Deno app slug the v2 logs endpoint is
// scoped to (GET /v2/apps/{slug}/logs).
vi.mock('../../src/infra/config/app.config', () => ({
  config: {
    denoSubhosting: {
      token: 'test-deno-token',
      organizationId: 'test-org-id',
      domain: 'function2.insforge.app',
    },
    cloud: {
      appKey: 'test-app-key',
    },
  },
}));

// Mock pool — use vi.hoisted so it's available in the hoisted vi.mock factory
const { mockPool } = vi.hoisted(() => ({
  mockPool: { query: vi.fn(), connect: vi.fn() },
}));

// Mock DatabaseManager to avoid real DB connections
vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

// Mock SecretService
vi.mock('../../src/services/secrets/secret.service', () => ({
  SecretService: {
    getInstance: () => ({
      listSecrets: vi.fn().mockResolvedValue([]),
      getSecretByKey: vi.fn().mockResolvedValue(null),
    }),
  },
}));

// Mock environment util
vi.mock('../../src/utils/environment', () => ({
  isCloudEnvironment: () => false,
}));

// Mock the log providers to avoid initialization issues
// Use vi.hoisted so mockLocalProvider is available in the hoisted mock factory
const { mockLocalProvider } = vi.hoisted(() => ({
  mockLocalProvider: {
    initialize: vi.fn(),
    getLogSources: vi.fn().mockResolvedValue([]),
    getLogsBySource: vi.fn().mockResolvedValue({ logs: [], total: 0, tableName: 'local' }),
    getLogSourceStats: vi.fn().mockResolvedValue([]),
    searchLogs: vi.fn().mockResolvedValue({ logs: [], total: 0 }),
    close: vi.fn(),
  },
}));

vi.mock('../../src/providers/logs/cloudwatch.provider', () => ({
  CloudWatchProvider: vi.fn().mockImplementation(() => mockLocalProvider),
}));

vi.mock('../../src/providers/logs/local.provider', () => ({
  LocalFileProvider: vi.fn().mockImplementation(() => mockLocalProvider),
}));

// Helper to create a mock fetch Response. The v2 logs endpoint returns a JSON
// object { logs, next_cursor } (consumed via response.json()).
function createMockResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    headers: {
      get: () => null,
    },
  };
}

// v2 RuntimeLogsResponse builder.
function logsResponse(
  entries: Array<{ timestamp: string; level: string; message: string; region?: string }>,
  nextCursor: string | null = null
) {
  return createMockResponse({ logs: entries, next_cursor: nextCursor });
}

// ============================================
// DenoSubhostingProvider.getDeploymentAppLogs (v2)
// ============================================

describe('DenoSubhostingProvider.getDeploymentAppLogs', () => {
  let provider: DenoSubhostingProvider;

  beforeEach(() => {
    vi.resetAllMocks();
    provider = DenoSubhostingProvider.getInstance();
  });

  it('fetches app logs and normalizes timestamp -> time', async () => {
    const entries = [
      {
        timestamp: '2025-01-15T10:00:00Z',
        level: 'info',
        message: 'Hello from function',
        region: 'us-east1',
      },
      {
        timestamp: '2025-01-15T10:00:01Z',
        level: 'error',
        message: 'Something failed',
        region: 'us-east1',
      },
    ];

    mockFetch.mockResolvedValue(logsResponse(entries));

    const result = await provider.getDeploymentAppLogs('rev-123');

    expect(result.logs).toHaveLength(2);
    expect(result.logs[0].message).toBe('Hello from function');
    expect(result.logs[0].time).toBe('2025-01-15T10:00:00Z');
    expect(result.logs[1].level).toBe('error');
    expect(result.cursor).toBeNull();
    expect(result.hasMore).toBe(false);

    // v2 endpoint is app-scoped and filtered by revision_id; auth header present.
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('https://api.deno.com/v2/apps/test-app-key/logs?');
    expect(calledUrl).toContain('revision_id=rev-123');
    // start is required by v2 — provider must always supply it.
    expect(calledUrl).toContain('start=');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-deno-token' }),
      })
    );
  });

  it('passes query parameters correctly', async () => {
    mockFetch.mockResolvedValue(logsResponse([]));

    await provider.getDeploymentAppLogs('rev-123', {
      query: 'error',
      level: 'error,warning',
      start: '2025-01-15T00:00:00Z',
      end: '2025-01-15T23:59:59Z',
      limit: 50,
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('query=error');
    expect(calledUrl).toContain('level=error%2Cwarning');
    expect(calledUrl).toContain('start=2025-01-15T00%3A00%3A00Z');
    expect(calledUrl).toContain('end=2025-01-15T23%3A59%3A59Z');
    expect(calledUrl).toContain('limit=50');
  });

  it('extracts cursor from next_cursor', async () => {
    mockFetch.mockResolvedValue(
      logsResponse(
        [
          {
            timestamp: '2025-01-15T10:00:00Z',
            level: 'info',
            message: 'Log entry',
            region: 'us-east1',
          },
        ],
        'abc123'
      )
    );

    const result = await provider.getDeploymentAppLogs('rev-123');

    expect(result.cursor).toBe('abc123');
    expect(result.hasMore).toBe(true);
  });

  it('returns null cursor when next_cursor is null', async () => {
    mockFetch.mockResolvedValue(logsResponse([]));

    const result = await provider.getDeploymentAppLogs('rev-123');

    expect(result.cursor).toBeNull();
    expect(result.hasMore).toBe(false);
  });

  it('defaults region to empty string when omitted', async () => {
    mockFetch.mockResolvedValue(
      logsResponse([{ timestamp: '2025-01-15T10:00:00Z', level: 'info', message: 'no region' }])
    );

    const result = await provider.getDeploymentAppLogs('rev-123');

    expect(result.logs[0].region).toBe('');
  });

  it('throws AppError on 404', async () => {
    mockFetch.mockResolvedValue(createMockResponse('Not found', 404));

    await expect(provider.getDeploymentAppLogs('nonexistent')).rejects.toThrow(AppError);
    await expect(provider.getDeploymentAppLogs('nonexistent')).rejects.toThrow(
      'Deployment not found: nonexistent'
    );
  });

  it('throws AppError on API error', async () => {
    mockFetch.mockResolvedValue(createMockResponse('Internal Server Error', 500));

    await expect(provider.getDeploymentAppLogs('rev-123')).rejects.toMatchObject({
      statusCode: 500,
      code: ERROR_CODES.UPSTREAM_FAILURE,
      message: 'Internal Server Error',
    });
  });

  it('throws AppError on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    await expect(provider.getDeploymentAppLogs('rev-123')).rejects.toMatchObject({
      statusCode: 502,
      code: ERROR_CODES.UPSTREAM_FAILURE,
      message: 'Network error',
    });
  });

  it('returns empty array when no logs', async () => {
    mockFetch.mockResolvedValue(logsResponse([]));

    const result = await provider.getDeploymentAppLogs('rev-123');

    expect(result.logs).toHaveLength(0);
    expect(result.hasMore).toBe(false);
  });
});

// ============================================
// LogService integration with Deno app logs
// ============================================

describe('LogService.getLogsBySource with Deno Subhosting', () => {
  let logService: LogService;

  beforeEach(async () => {
    vi.resetAllMocks();

    logService = LogService.getInstance();

    // Directly set the internal provider to avoid calling initialize() which
    // creates real provider instances. We inject a mock provider via type cast.
    const mockProvider = {
      initialize: vi.fn(),
      getLogSources: vi.fn().mockResolvedValue([]),
      getLogsBySource: vi.fn().mockResolvedValue({ logs: [], total: 0, tableName: 'local' }),
      getLogSourceStats: vi.fn().mockResolvedValue([]),
      searchLogs: vi.fn().mockResolvedValue({ logs: [], total: 0 }),
      close: vi.fn(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (logService as any).provider = mockProvider;
  });

  it('routes function.logs to Deno API when Subhosting is configured', async () => {
    // Mock DB query for latest deployment (revision) ID
    mockPool.query.mockResolvedValue({
      rows: [{ id: 'rev-latest' }],
    });

    mockFetch.mockResolvedValue(
      logsResponse([
        {
          timestamp: '2025-01-15T10:00:00Z',
          level: 'info',
          message: 'Function executed',
          region: 'us-east1',
        },
        {
          timestamp: '2025-01-15T10:00:05Z',
          level: 'warning',
          message: 'Slow query',
          region: 'us-east1',
        },
      ])
    );

    const result = await logService.getLogsBySource('function.logs', 100);

    expect(result.tableName).toBe('deno-subhosting');
    expect(result.logs).toHaveLength(2);
    // Plain-text lines surface as event_message; severity comes from
    // body.metadata.level (the shape the dashboard reads).
    expect(result.logs[0].eventMessage).toBe('Function executed');
    expect(result.logs[0].timestamp).toBe('2025-01-15T10:00:00Z');
    expect(result.logs[0].body).toEqual({
      event_message: 'Function executed',
      metadata: { level: 'info', region: 'us-east1' },
    });
    expect(result.logs[1].eventMessage).toBe('Slow query');
    expect(result.logs[1].body.metadata).toEqual({ level: 'warning', region: 'us-east1' });
  });

  it('parses structured router request logs into an access line', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ id: 'rev-latest' }] });

    // The auto-generated router emits this via console.log(JSON.stringify(...));
    // Deno captures it verbatim with a trailing newline.
    mockFetch.mockResolvedValue(
      logsResponse([
        {
          timestamp: '2025-01-15T10:00:00Z',
          level: 'info',
          message:
            '{"timestamp":"2025-01-15T10:00:00Z","slug":"server-timestamp","method":"GET","status":200,"duration":"1ms"}\n',
          region: '',
        },
      ])
    );

    const result = await logService.getLogsBySource('function.logs', 100);

    expect(result.logs[0].eventMessage).toBe('GET server-timestamp 200 1ms');
    expect(result.logs[0].body.event_message).toBe('GET server-timestamp 200 1ms');
    expect(result.logs[0].body.metadata).toEqual({ level: 'info' });
    // Parsed fields stay in the body for the detail panel.
    expect(result.logs[0].body.slug).toBe('server-timestamp');
    expect(result.logs[0].body.status).toBe(200);
  });

  it('lifts a structured log level into metadata and uses its message', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ id: 'rev-latest' }] });

    mockFetch.mockResolvedValue(
      logsResponse([
        {
          timestamp: '2025-01-15T10:00:00Z',
          level: 'info', // Deno's line level…
          message: '{"level":"error","message":"cache miss"}', // …overridden by the structured level
          region: 'us-east1',
        },
      ])
    );

    const result = await logService.getLogsBySource('function.logs', 100);

    expect(result.logs[0].eventMessage).toBe('cache miss');
    expect(result.logs[0].body.metadata).toEqual({ level: 'error', region: 'us-east1' });
  });

  it('also works with deno-relay-logs source name', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{ id: 'rev-latest' }],
    });
    mockFetch.mockResolvedValue(logsResponse([]));

    const result = await logService.getLogsBySource('deno-relay-logs', 50);

    expect(result.tableName).toBe('deno-subhosting');
  });

  it('returns empty logs when no successful deployment exists', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const result = await logService.getLogsBySource('function.logs', 100);

    expect(result.logs).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.tableName).toBe('deno-subhosting');
    // Should not have called Deno API
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('passes beforeTimestamp as the end parameter to Deno API', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{ id: 'rev-latest' }],
    });
    mockFetch.mockResolvedValue(logsResponse([]));

    await logService.getLogsBySource('function.logs', 50, '2025-01-15T09:00:00Z');

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('end=2025-01-15T09%3A00%3A00Z');
    expect(calledUrl).toContain('limit=50');
    // provider derives a default start window (24h before end).
    expect(calledUrl).toContain('start=2025-01-14T09%3A00%3A00');
  });

  it('does not send a level filter so all severities are returned', async () => {
    // Deno's `level` param is an exact-match filter, not a min-severity threshold.
    // Omitting it surfaces the full runtime log stream (error, warning, info, debug).
    mockPool.query.mockResolvedValue({
      rows: [{ id: 'rev-latest' }],
    });

    mockFetch.mockResolvedValue(
      logsResponse([
        {
          timestamp: '2025-01-15T10:00:00Z',
          level: 'debug',
          message: 'isolate start time',
          region: 'us-east1',
        },
        {
          timestamp: '2025-01-15T10:00:01Z',
          level: 'info',
          message: 'request handled',
          region: 'us-east1',
        },
        { timestamp: '2025-01-15T10:00:02Z', level: 'error', message: 'boom', region: 'us-east1' },
      ])
    );

    const result = await logService.getLogsBySource('function.logs', 100);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('level=');
    // All severities flow through, not just debug
    expect(result.logs.map((l) => (l.body.metadata as { level: string }).level)).toEqual([
      'debug',
      'info',
      'error',
    ]);
  });

  it('generates unique log IDs from deployment ID and timestamp', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{ id: 'rev-abc' }],
    });

    mockFetch.mockResolvedValue(
      logsResponse([
        { timestamp: '2025-01-15T10:00:00Z', level: 'info', message: 'Log 1', region: 'us-east1' },
        { timestamp: '2025-01-15T10:00:00Z', level: 'info', message: 'Log 2', region: 'us-east1' },
      ])
    );

    const result = await logService.getLogsBySource('function.logs', 100);

    // Same timestamp but different index ensures unique IDs
    expect(result.logs[0].id).toBe('deno-rev-abc-2025-01-15T10:00:00Z-0');
    expect(result.logs[1].id).toBe('deno-rev-abc-2025-01-15T10:00:00Z-1');
  });

  it('falls back to provider for non-function-logs sources', async () => {
    const result = await logService.getLogsBySource('insforge.logs', 100);

    // Should use the mocked local provider, not Deno
    expect(result.tableName).toBe('local');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ============================================
// FunctionService.getLatestSuccessfulDeploymentId
// ============================================

describe('FunctionService.getLatestSuccessfulDeploymentId', () => {
  let functionService: FunctionService;

  beforeEach(() => {
    vi.resetAllMocks();
    functionService = FunctionService.getInstance();
  });

  it('returns deployment ID when successful deployment exists', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{ id: 'deploy-success-1' }],
    });

    const id = await functionService.getLatestSuccessfulDeploymentId();

    expect(id).toBe('deploy-success-1');
    expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining("status = 'success'"));
  });

  it('returns null when no successful deployment exists', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const id = await functionService.getLatestSuccessfulDeploymentId();

    expect(id).toBeNull();
  });

  it('returns null on database error', async () => {
    mockPool.query.mockRejectedValue(new Error('DB connection lost'));

    const id = await functionService.getLatestSuccessfulDeploymentId();

    expect(id).toBeNull();
  });
});
