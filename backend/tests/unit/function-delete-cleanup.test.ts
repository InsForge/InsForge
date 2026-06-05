import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionService } from '../../src/services/functions/function.service.js';

const clientQueryMock = vi.fn();
const releaseMock = vi.fn();

const mockPool = {
  query: vi.fn(),
  connect: vi.fn().mockResolvedValue({
    query: clientQueryMock,
    release: releaseMock,
  }),
};

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

vi.mock('../../src/providers/functions/deno-subhosting.provider.js', () => ({
  DenoSubhostingProvider: {
    getInstance: () => ({
      isConfigured: vi.fn().mockReturnValue(false),
    }),
  },
}));

vi.mock('../../src/services/secrets/secret.service.js', () => ({
  SecretService: {
    getInstance: () => ({}),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('FunctionService.deleteFunction — deployment cleanup', () => {
  let service: FunctionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = FunctionService.getInstance();
  });

  it('removes the slug from deployment records inside a transaction', async () => {
    clientQueryMock
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1 }) // DELETE FROM functions.definitions
      .mockResolvedValueOnce({ rowCount: 3 }) // UPDATE functions.deployments
      .mockResolvedValueOnce({}); // COMMIT

    const result = await service.deleteFunction('my-func');

    expect(result).toBe(true);

    const sqlCalls = clientQueryMock.mock.calls.map(([sql]) => sql as string);
    expect(sqlCalls[0]).toBe('BEGIN');
    expect(sqlCalls).toContainEqual(expect.stringContaining('DELETE FROM functions.definitions'));
    expect(sqlCalls).toContainEqual(
      expect.stringContaining('UPDATE functions.deployments SET functions = functions - $1')
    );
    expect(sqlCalls[sqlCalls.length - 1]).toBe('COMMIT');

    // Verify the UPDATE uses correct parameters
    const updateCall = clientQueryMock.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('UPDATE functions.deployments')
    );
    expect(updateCall?.[1]).toEqual(['my-func', JSON.stringify(['my-func'])]);
  });

  it('rolls back and returns false when function not found', async () => {
    clientQueryMock
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 0 }) // DELETE — no match
      .mockResolvedValueOnce({}); // ROLLBACK

    const result = await service.deleteFunction('nonexistent');

    expect(result).toBe(false);

    const sqlCalls = clientQueryMock.mock.calls.map(([sql]) => sql as string);
    expect(sqlCalls).toContain('ROLLBACK');
    expect(sqlCalls).not.toContain('COMMIT');
  });

  it('rolls back on cleanup failure and releases the client with the error', async () => {
    const cleanupError = new Error('connection lost');

    clientQueryMock
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1 }) // DELETE — success
      .mockRejectedValueOnce(cleanupError) // UPDATE — fails
      .mockResolvedValueOnce({}); // ROLLBACK

    await expect(service.deleteFunction('my-func')).rejects.toBe(cleanupError);

    const sqlCalls = clientQueryMock.mock.calls.map(([sql]) => sql as string);
    expect(sqlCalls).toContain('ROLLBACK');
    expect(sqlCalls).not.toContain('COMMIT');
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('still triggers redeployment after successful cleanup', async () => {
    clientQueryMock
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1 }) // DELETE
      .mockResolvedValueOnce({ rowCount: 0 }) // UPDATE (no deployments matched)
      .mockResolvedValueOnce({}); // COMMIT

    const scheduleSpy = vi.spyOn(service as never, 'scheduleDeployment' as never);

    await service.deleteFunction('my-func');

    expect(scheduleSpy).toHaveBeenCalledTimes(1);
  });
});
