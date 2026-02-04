import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DenoSubhostingProvider } from '../../src/providers/functions/deno-subhosting.provider';
import { LogService } from '../../src/services/logs/log.service';
import { FunctionService } from '../../src/services/functions/function.service';
import { AppError } from '../../src/api/middlewares/error';

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

// Mock config
vi.mock('../../src/infra/config/app.config', () => ({
  config: {
    denoSubhosting: {
      token: 'test-deno-token',
      organizationId: 'test-org-id',
      domain: 'deno.dev',
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

// Helper to create a mock fetch Response
function createMockResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    headers: {
      get: (name: string) => headers[name.toLowerCase()] || null,
    },
  };
}

// ============================================
// DenoSubhostingProvider.getDeploymentAppLogs
// ============================================

describe('DenoSubhostingProvider.getDeploymentAppLogs', () => {
  let provider: DenoSubhostingProvider;

  beforeEach(() => {
    vi.resetAllMocks();
    provider = DenoSubhostingProvider.getInstance();
  });

  it('fetches app logs with default options', async () => {
    const mockLogs = [
      { time: '2025-01-15T10:00:00Z', level: 'info', message: 'Hello from function', region: 'us-east1' },
      { time: '2025-01-15T10:00:01Z', level: 'error', message: 'Something failed', region: 'us-east1' },
    ];

    mockFetch.mockResolvedValue(createMockResponse(mockLogs));

    const result = await provider.getDeploymentAppLogs('deploy-123');

    expect(result.logs).toHaveLength(2);
    expect(result.logs[0].message).toBe('Hello from function');
    expect(result.logs[1].level).toBe('error');
    expect(result.cursor).toBeNull();
    expect(result.hasMore).toBe(false);

    // Verify fetch was called with correct URL and auth
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.deno.com/v1/deployments/deploy-123/app_logs',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-deno-token' },
      })
    );
  });

  it('passes query parameters correctly', async () => {
    mockFetch.mockResolvedValue(createMockResponse([]));

    await provider.getDeploymentAppLogs('deploy-123', {
      q: 'error',
      level: 'error,warning',
      since: '2025-01-15T00:00:00Z',
      until: '2025-01-15T23:59:59Z',
      limit: 50,
      order: 'asc',
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('q=error');
    expect(calledUrl).toContain('level=error%2Cwarning');
    expect(calledUrl).toContain('since=2025-01-15T00%3A00%3A00Z');
    expect(calledUrl).toContain('until=2025-01-15T23%3A59%3A59Z');
    expect(calledUrl).toContain('limit=50');
    expect(calledUrl).toContain('order=asc');
  });

  it('extracts cursor from Link header', async () => {
    const mockLogs = [
      { time: '2025-01-15T10:00:00Z', level: 'info', message: 'Log entry', region: 'us-east1' },
    ];

    const linkHeader = '<https://api.deno.com/v1/deployments/deploy-123/app_logs?cursor=abc123>; rel="next"';
    mockFetch.mockResolvedValue(createMockResponse(mockLogs, 200, { link: linkHeader }));

    const result = await provider.getDeploymentAppLogs('deploy-123');

    expect(result.cursor).toBe('abc123');
    expect(result.hasMore).toBe(true);
  });

  it('returns null cursor when no Link header', async () => {
    mockFetch.mockResolvedValue(createMockResponse([]));

    const result = await provider.getDeploymentAppLogs('deploy-123');

    expect(result.cursor).toBeNull();
    expect(result.hasMore).toBe(false);
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

    await expect(provider.getDeploymentAppLogs('deploy-123')).rejects.toThrow(AppError);
  });

  it('throws AppError on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    await expect(provider.getDeploymentAppLogs('deploy-123')).rejects.toThrow(
      'Failed to get deployment app logs'
    );
  });

  it('returns empty array when no logs', async () => {
    mockFetch.mockResolvedValue(createMockResponse([]));

    const result = await provider.getDeploymentAppLogs('deploy-123');

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
    // Mock DB query for latest deployment ID
    mockPool.query.mockResolvedValue({
      rows: [{ id: 'deploy-latest' }],
    });

    // Mock Deno API response
    const mockLogs = [
      { time: '2025-01-15T10:00:00Z', level: 'info', message: 'Function executed', region: 'us-east1' },
      { time: '2025-01-15T10:00:05Z', level: 'warning', message: 'Slow query', region: 'us-east1' },
    ];
    mockFetch.mockResolvedValue(createMockResponse(mockLogs));

    const result = await logService.getLogsBySource('function.logs', 100);

    expect(result.tableName).toBe('deno-subhosting');
    expect(result.logs).toHaveLength(2);
    expect(result.logs[0].eventMessage).toBe('Function executed');
    expect(result.logs[0].timestamp).toBe('2025-01-15T10:00:00Z');
    expect(result.logs[0].body).toEqual({
      level: 'info',
      region: 'us-east1',
      message: 'Function executed',
    });
    expect(result.logs[1].eventMessage).toBe('Slow query');
  });

  it('also works with deno-relay-logs source name', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{ id: 'deploy-latest' }],
    });
    mockFetch.mockResolvedValue(createMockResponse([]));

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

  it('passes beforeTimestamp as until parameter to Deno API', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{ id: 'deploy-latest' }],
    });
    mockFetch.mockResolvedValue(createMockResponse([]));

    await logService.getLogsBySource('function.logs', 50, '2025-01-15T09:00:00Z');

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('until=2025-01-15T09%3A00%3A00Z');
    expect(calledUrl).toContain('limit=50');
    expect(calledUrl).toContain('order=desc');
  });

  it('generates unique log IDs from deployment ID and timestamp', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{ id: 'deploy-abc' }],
    });

    const mockLogs = [
      { time: '2025-01-15T10:00:00Z', level: 'info', message: 'Log 1', region: 'us-east1' },
      { time: '2025-01-15T10:00:00Z', level: 'info', message: 'Log 2', region: 'us-east1' },
    ];
    mockFetch.mockResolvedValue(createMockResponse(mockLogs));

    const result = await logService.getLogsBySource('function.logs', 100);

    // Same timestamp but different index ensures unique IDs
    expect(result.logs[0].id).toBe('deno-deploy-abc-2025-01-15T10:00:00Z-0');
    expect(result.logs[1].id).toBe('deno-deploy-abc-2025-01-15T10:00:00Z-1');
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
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'success'")
    );
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
